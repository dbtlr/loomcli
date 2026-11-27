//! The built command graph projections read, and locating a word in an unfinished invocation.
//!
//! [`CommandGraph`] is plain data. Its serde serialization reproduces the JSON the reference's
//! `JSON.stringify(app.inspect())` writes: the same key names, the same key order, `null` where the
//! reference holds `null`, and no key where it holds `undefined`. The manifest and MCP projections
//! derive from it.

pub(crate) mod attach;
pub(crate) mod build;

use std::sync::Arc;

use serde::Serialize;

use crate::__private::ExtensionOwners;
use crate::invocation::parse;
use crate::marks::RequiredWhen;
use crate::shipping::Build;

/// A published input JSON Schema: an object, or `None` (`null`) where the graph holds none.
pub type InputSchema = Option<serde_json::Map<String, serde_json::Value>>;

/// The JSON Schema dialect published input schemas are read in, draft 2020-12, as the URI a
/// schema's `$schema` member names.
pub const JSON_SCHEMA_DIALECT: &str = "https://json-schema.org/draft/2020-12/schema";

/// `schema` as a validator publishes it under [`JSON_SCHEMA_DIALECT`]: a `$schema` member naming
/// the dialect first, then `schema`'s own members in their order, as the reference's
/// `{ $schema: dialect, ...schema }` builds it. A `$schema` member `schema` holds keeps the first
/// place and takes `schema`'s value.
#[must_use]
pub fn with_schema_dialect(
    schema: serde_json::Map<String, serde_json::Value>,
) -> serde_json::Map<String, serde_json::Value> {
    let mut published = serde_json::Map::with_capacity(schema.len() + 1);
    published.insert("$schema".to_owned(), JSON_SCHEMA_DIALECT.into());
    published.extend(schema);
    published
}

/// A declared default, as `{ "value": … }`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[non_exhaustive]
pub struct DeclaredDefault {
    /// The raw default: a string, or a list of strings.
    pub value: serde_json::Value,
}

/// The kind of an option group.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[non_exhaustive]
pub enum OptionGroupKind {
    /// At most one member is supplied.
    #[serde(rename = "exclusive")]
    Exclusive,
    /// At least one member is supplied.
    #[serde(rename = "oneRequired")]
    OneRequired,
    /// All members or none are supplied.
    #[serde(rename = "requiredTogether")]
    RequiredTogether,
    /// Supplying one option requires each of the options it names.
    #[serde(rename = "requires")]
    Requires,
}

/// A declared relationship over local options, in declaration order.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[non_exhaustive]
#[serde(tag = "kind")]
pub enum OptionGroup {
    /// At most one member claims the group.
    #[non_exhaustive]
    #[serde(rename = "exclusive")]
    Exclusive {
        /// The members, by declared name.
        options: Vec<String>,
    },
    /// At least one member is supplied.
    #[non_exhaustive]
    #[serde(rename = "oneRequired")]
    OneRequired {
        /// The members, by declared name.
        options: Vec<String>,
    },
    /// All members or none are supplied.
    #[non_exhaustive]
    #[serde(rename = "requiredTogether")]
    RequiredTogether {
        /// The members, by declared name.
        options: Vec<String>,
    },
    /// Supplying one option requires each of the options it names.
    #[non_exhaustive]
    #[serde(rename = "requires")]
    Requires {
        /// The declared name of the option that has the requirement.
        option: String,
        /// The declared names of the options it needs, in order.
        requires: Vec<String>,
    },
}

impl OptionGroup {
    /// The kind of relationship this group declares.
    #[must_use]
    pub fn kind(&self) -> OptionGroupKind {
        match self {
            Self::Exclusive { .. } => OptionGroupKind::Exclusive,
            Self::OneRequired { .. } => OptionGroupKind::OneRequired,
            Self::RequiredTogether { .. } => OptionGroupKind::RequiredTogether,
            Self::Requires { .. } => OptionGroupKind::Requires,
        }
    }

    /// Every member's declared name, with a requirement's trigger first.
    pub fn members(&self) -> impl Iterator<Item = &str> {
        let (first, others) = match self {
            Self::Exclusive { options }
            | Self::OneRequired { options }
            | Self::RequiredTogether { options } => (None, options),
            Self::Requires { option, requires } => (Some(option.as_str()), requires),
        };
        first.into_iter().chain(others.iter().map(String::as_str))
    }
}

/// A result's kind.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ResultKindName {
    /// One value.
    Value,
    /// A sequence of rows.
    Rows,
}

/// A declared result. Keys: `default`, `kind`, `mediaTypes`, `views`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ResultNode {
    /// The default view's name.
    pub default: String,
    /// Value or rows.
    pub kind: ResultKindName,
    /// Each view's media type by view name, `null` where a view declares none.
    pub media_types: serde_json::Map<String, serde_json::Value>,
    /// The view names, in declaration order.
    pub views: Vec<String>,
}

/// A standalone stdin declaration. Keys: `description`, `required`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[non_exhaustive]
pub struct StdinNode {
    /// The description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Whether piped stdin is required.
    pub required: bool,
}

/// An argument. Keys, in order: `max`, `min`, `stdin`, `type` (content arguments alone), `default`,
/// `description`, `extensions`, `name`, `required`, `requiredWhen`, `schema`, `validateOmitted`,
/// `validated`, `variadic`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ArgumentNode {
    /// The most sources a variadic content argument accepts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<usize>,
    /// The fewest sources a variadic content argument accepts.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<usize>,
    /// Whether a content argument reads piped stdin.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin: Option<bool>,
    /// `content` on a content argument.
    #[serde(rename = "type", skip_serializing_if = "Option::is_none")]
    pub kind: Option<ContentType>,
    /// The declared default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<DeclaredDefault>,
    /// The description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Extension values by identity.
    pub extensions: serde_json::Map<String, serde_json::Value>,
    #[serde(skip)]
    pub(crate) owners: ExtensionOwners,
    /// The declared name.
    pub name: String,
    /// Whether it is required.
    pub required: bool,
    /// When it is required beyond `required`.
    pub required_when: Option<RequiredWhen>,
    /// The published input schema.
    pub schema: InputSchema,
    /// Whether its omission reaches its validator.
    pub validate_omitted: bool,
    /// Whether it has a validator.
    pub validated: bool,
    /// Whether it takes the words left after binding the other arguments.
    pub variadic: bool,
}

/// The `type` of a content input.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub enum ContentType {
    /// `content`.
    #[serde(rename = "content")]
    Content,
}

/// A string option. Keys, in order: `aliases`, `control`, `deprecated`, `description`, `env`,
/// `extensions`, `hidden`, `long`, `name`, `short`, `visibleAliases`, `default`, `envDelimiter`, `implied`,
/// `multiple`, `required`, `requiredWhen`, `schema`, `validateOmitted`, `validated`, `background`,
/// `envAllowEmpty`, `type`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct StringOptionNode {
    /// All aliases as bare names: the unadvertised list, then the visible list, each in list
    /// order, without repeats.
    pub aliases: Vec<String>,
    /// Whether it controls the invocation.
    pub control: bool,
    /// The migration message of a deprecated option.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<String>,
    /// The description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Bound environment variables.
    pub env: Vec<String>,
    /// Extension values by identity.
    pub extensions: serde_json::Map<String, serde_json::Value>,
    #[serde(skip)]
    pub(crate) owners: ExtensionOwners,
    /// Whether it is kept off listings.
    pub hidden: bool,
    /// The long spelling.
    pub long: Option<String>,
    /// The declared name.
    pub name: String,
    /// The short spelling.
    pub short: Option<String>,
    /// The visible aliases as bare names, in the order they appear in `aliases`.
    pub visible_aliases: Vec<String>,
    /// The declared default.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<DeclaredDefault>,
    /// The environment delimiter of a multiple option or a scalar arity option.
    pub env_delimiter: Option<String>,
    /// The implied value.
    pub implied: Option<String>,
    /// Whether it takes several values.
    pub multiple: bool,
    /// Whether it is required.
    pub required: bool,
    /// When it is required beyond `required`.
    pub required_when: Option<RequiredWhen>,
    /// The published input schema.
    pub schema: InputSchema,
    /// Whether its omission reaches its validator.
    pub validate_omitted: bool,
    /// Whether it has a validator.
    pub validated: bool,
    /// The number of separate words in one occurrence, if declared.
    pub arity: Option<usize>,
    /// Whether it states the background.
    pub background: bool,
    /// Whether an empty environment value fills it.
    pub env_allow_empty: bool,
    /// Whether a later argv occurrence replaces an earlier one.
    pub last_wins: bool,
    #[serde(rename = "type")]
    pub(crate) kind: StringType,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum StringType {
    #[serde(rename = "string")]
    String,
}

/// A content option. Keys, in order: the shared keys of [`StringOptionNode`] through `validated`,
/// then `max`, `min`, `stdin`, `type`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct ContentOptionNode {
    /// All aliases as bare names: the unadvertised list, then the visible list, each in list
    /// order, without repeats.
    pub aliases: Vec<String>,
    /// Whether it controls the invocation.
    pub control: bool,
    /// The migration message of a deprecated option.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<String>,
    /// The description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Bound environment variables.
    pub env: Vec<String>,
    /// Extension values by identity.
    pub extensions: serde_json::Map<String, serde_json::Value>,
    #[serde(skip)]
    pub(crate) owners: ExtensionOwners,
    /// Whether it is kept off listings.
    pub hidden: bool,
    /// The long spelling.
    pub long: Option<String>,
    /// The declared name.
    pub name: String,
    /// The short spelling.
    pub short: Option<String>,
    /// The visible aliases as bare names, in the order they appear in `aliases`.
    pub visible_aliases: Vec<String>,
    /// A content option declares no default; always absent.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<DeclaredDefault>,
    /// The environment delimiter of a multiple option.
    pub env_delimiter: Option<String>,
    /// A content option implies no value; always `null`.
    pub implied: Option<String>,
    /// Whether it takes several sources.
    pub multiple: bool,
    /// Whether it is required.
    pub required: bool,
    /// When it is required beyond `required`.
    pub required_when: Option<RequiredWhen>,
    /// `{"minLength":1,"type":"string"}`.
    pub schema: InputSchema,
    /// Always false.
    pub validate_omitted: bool,
    /// Always true.
    pub validated: bool,
    /// The most sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max: Option<usize>,
    /// The fewest sources.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub min: Option<usize>,
    /// Whether it reads piped stdin.
    pub stdin: bool,
    #[serde(rename = "type")]
    pub(crate) kind: ContentType,
}

/// A Boolean option. Keys, in order: the shared keys through `visibleAliases`, then `color`, `interaction`,
/// `negative`, `plain`, `polarity`, `schema`, `type`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct BooleanOptionNode {
    /// All aliases as bare names: the unadvertised list, then the visible list, each in list
    /// order, without repeats.
    pub aliases: Vec<String>,
    /// Whether it controls the invocation.
    pub control: bool,
    /// The migration message of a deprecated option.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<String>,
    /// The description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Bound environment variables.
    pub env: Vec<String>,
    /// Extension values by identity.
    pub extensions: serde_json::Map<String, serde_json::Value>,
    #[serde(skip)]
    pub(crate) owners: ExtensionOwners,
    /// Whether it is kept off listings.
    pub hidden: bool,
    /// The long spelling.
    pub long: Option<String>,
    /// The declared name.
    pub name: String,
    /// The short spelling.
    pub short: Option<String>,
    /// The visible aliases as bare names, in the order they appear in `aliases`.
    pub visible_aliases: Vec<String>,
    /// Whether it carries the color mark.
    pub color: bool,
    /// Whether it carries the interaction mark.
    pub interaction: bool,
    /// The negative spelling.
    pub negative: Option<String>,
    /// Whether its spellings turn the run's plain switch on.
    pub plain: bool,
    /// Its polarity.
    pub polarity: crate::inputs::Polarity,
    /// Always `null`.
    pub schema: InputSchema,
    #[serde(rename = "type")]
    pub(crate) kind: BooleanType,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum BooleanType {
    #[serde(rename = "boolean")]
    Boolean,
}

/// A counted option. Keys, in order: the shared keys through `visibleAliases`, then `quiet`, `schema`,
/// `type`, `verbose`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CountOptionNode {
    /// All aliases as bare names: the unadvertised list, then the visible list, each in list
    /// order, without repeats.
    pub aliases: Vec<String>,
    /// Whether it controls the invocation.
    pub control: bool,
    /// The migration message of a deprecated option.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<String>,
    /// The description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Bound environment variables.
    pub env: Vec<String>,
    /// Extension values by identity.
    pub extensions: serde_json::Map<String, serde_json::Value>,
    #[serde(skip)]
    pub(crate) owners: ExtensionOwners,
    /// Whether it is kept off listings.
    pub hidden: bool,
    /// The long spelling.
    pub long: Option<String>,
    /// The declared name.
    pub name: String,
    /// The short spelling.
    pub short: Option<String>,
    /// The visible aliases as bare names, in the order they appear in `aliases`.
    pub visible_aliases: Vec<String>,
    /// Whether it carries the quiet mark.
    pub quiet: bool,
    /// Always `null`.
    pub schema: InputSchema,
    #[serde(rename = "type")]
    pub(crate) kind: CountType,
    /// Whether it carries the verbose mark.
    pub verbose: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
pub(crate) enum CountType {
    #[serde(rename = "count")]
    Count,
}

/// An option of any kind, serialized as its kind's node.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(untagged)]
#[non_exhaustive]
pub enum OptionNode {
    /// A string option.
    String(StringOptionNode),
    /// A content option.
    Content(ContentOptionNode),
    /// A Boolean option.
    Boolean(BooleanOptionNode),
    /// A counted option.
    Count(CountOptionNode),
}

/// Reads one field shared by every option node.
macro_rules! shared_field {
    ($node:expr, $field:ident) => {
        match $node {
            OptionNode::String(node) => &node.$field,
            OptionNode::Content(node) => &node.$field,
            OptionNode::Boolean(node) => &node.$field,
            OptionNode::Count(node) => &node.$field,
        }
    };
}

impl OptionNode {
    /// The count of words each arity occurrence takes.
    #[must_use]
    pub fn arity(&self) -> Option<usize> {
        match self {
            Self::String(node) => node.arity,
            _ => None,
        }
    }

    /// The declared name.
    #[must_use]
    pub fn name(&self) -> &str {
        shared_field!(self, name)
    }

    /// The long spelling.
    #[must_use]
    pub fn long(&self) -> Option<&str> {
        shared_field!(self, long).as_deref()
    }

    /// The short spelling.
    #[must_use]
    pub fn short(&self) -> Option<&str> {
        shared_field!(self, short).as_deref()
    }

    /// All aliases as bare names: the unadvertised list, then the visible list, each in list
    /// order, without repeats.
    #[must_use]
    pub fn aliases(&self) -> &[String] {
        shared_field!(self, aliases)
    }

    /// The visible aliases as bare names, in the order they appear in `aliases()`.
    #[must_use]
    pub fn visible_aliases(&self) -> &[String] {
        shared_field!(self, visible_aliases)
    }

    /// Whether it is kept off listings.
    #[must_use]
    pub fn hidden(&self) -> bool {
        *shared_field!(self, hidden)
    }

    /// The deprecation message.
    #[must_use]
    pub fn deprecated(&self) -> Option<&str> {
        shared_field!(self, deprecated).as_deref()
    }

    /// The extension values.
    #[must_use]
    pub fn extensions(&self) -> &serde_json::Map<String, serde_json::Value> {
        shared_field!(self, extensions)
    }

    /// The descriptor that stored each extension value.
    pub(crate) fn owners(&self) -> &ExtensionOwners {
        shared_field!(self, owners)
    }
}

/// An enabled passthrough declaration as published in the command graph.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[non_exhaustive]
pub struct PassthroughNode {
    /// The optional description for the words after the delimiter.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
}

/// One Command. Keys, in order: `optionGroups`, `passthrough`, `stdin` (when declared), `aliases`, `arguments`,
/// `children`, `deprecated`, `description`, `extensions`, `hasAction`, `hidden`, `name`, `needsTerminal`, `options`,
/// `path`, `result`, `visibleAliases`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
#[non_exhaustive]
pub struct CommandNode {
    /// The declared option groups.
    pub option_groups: Vec<OptionGroup>,
    /// The passthrough declaration, serialized as `null` when the mode is off.
    pub passthrough: Option<PassthroughNode>,
    /// The standalone stdin declaration.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub stdin: Option<StdinNode>,
    /// All aliases as bare names, in declaration order.
    pub aliases: Vec<String>,
    /// Arguments, in declaration order. Each is shared, so a reader such as `locate` hands back the
    /// graph's own node and a caller compares by `Arc::ptr_eq`.
    pub arguments: Vec<Arc<ArgumentNode>>,
    /// Children, in authoring order: the plugins' Commands first.
    pub children: Vec<Arc<CommandNode>>,
    /// The migration message of a deprecated Command.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deprecated: Option<String>,
    /// The description; the root reports the Application's.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Extension values by identity.
    pub extensions: serde_json::Map<String, serde_json::Value>,
    #[serde(skip)]
    pub(crate) owners: ExtensionOwners,
    /// Whether it registered an action.
    pub has_action: bool,
    /// Whether it is kept off listings.
    pub hidden: bool,
    /// The canonical name; `null` for the root.
    pub name: Option<String>,
    /// Whether this Command's action needs stdin and stderr at a terminal outside CI.
    pub needs_terminal: bool,
    /// Local options, hook-declared ones included, in declaration order; shared, as `arguments` are.
    pub options: Vec<Arc<OptionNode>>,
    /// The route from the root; empty for the root.
    pub path: Vec<String>,
    /// The declared result.
    pub result: Option<ResultNode>,
    /// The visible aliases as bare names, in the order they appear in `aliases`.
    pub visible_aliases: Vec<String>,
}

/// The configuration fact. Keys: `schema`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[non_exhaustive]
pub struct ConfigurationNode {
    /// The configuration's published schema.
    pub schema: InputSchema,
}

/// The declared graph as plain data. Keys, in order: `configuration`, `description`, `globals`,
/// `name`, `root`, `version`.
#[derive(Clone, Debug, PartialEq, Serialize)]
#[non_exhaustive]
pub struct CommandGraph {
    /// The configuration fact, `null` when no plugin claims the source slot.
    pub configuration: Option<ConfigurationNode>,
    /// The Application's description.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    /// Every global option: the application's, then each plugin's in installation order; shared,
    /// as a Command's options are.
    pub globals: Vec<Arc<OptionNode>>,
    /// The application name.
    pub name: String,
    /// The root Command.
    pub root: Arc<CommandNode>,
    /// The version, `0.0.0` when unversioned.
    pub version: String,
    #[serde(skip)]
    pub(crate) build: Option<Build>,
    #[serde(skip)]
    pub(crate) link: Arc<crate::__private::GraphLink>,
}

impl CommandGraph {
    /// The Command at `path`, by canonical names.
    #[must_use]
    pub fn command(&self, path: &[&str]) -> Option<&Arc<CommandNode>> {
        let mut node = &self.root;
        for name in path {
            node = node
                .children
                .iter()
                .find(|child| child.name.as_deref() == Some(*name))?;
        }
        Some(node)
    }
}

/// The earlier words an unfinished invocation gave each input, keyed by declared name.
#[derive(Clone, Debug, Default)]
#[non_exhaustive]
pub struct TypedInputs {
    /// Raw option words, with arity occurrences flattened in the order read.
    pub options: std::collections::BTreeMap<String, Vec<String>>,
    /// Raw positional words bound to their argument slots.
    pub arguments: std::collections::BTreeMap<String, Vec<String>>,
}

/// Where a word in an unfinished invocation sits, for completion. Every node is the graph's own
/// `Arc`, so a reader compares by `Arc::ptr_eq`.
#[derive(Clone, Debug)]
#[non_exhaustive]
pub enum WordPosition {
    /// A child name or the first positional word of the Command routing reached.
    Command {
        /// The first declared argument, if the word names no child.
        argument: Option<Arc<ArgumentNode>>,
        /// The Command routing reached.
        command: Arc<CommandNode>,
        /// The words the earlier part of the invocation gave its inputs.
        typed: TypedInputs,
        /// The partial word.
        prefix: String,
    },
    /// An option spelling.
    Option {
        /// The Command routing reached.
        command: Arc<CommandNode>,
        /// The words the earlier part of the invocation gave its inputs.
        typed: TypedInputs,
        /// The partial word.
        prefix: String,
        /// The options already supplied, by declared name.
        supplied: Vec<String>,
        /// The counted options' counts, by name, in the order the earlier words first gave each.
        counts: Vec<(String, u32)>,
        /// The Boolean options' values, by name, in the order the earlier words first gave each.
        booleans: Vec<(String, bool)>,
    },
    /// An option's value.
    Value {
        /// The Command routing reached.
        command: Arc<CommandNode>,
        /// The words the earlier part of the invocation gave its inputs.
        typed: TypedInputs,
        /// The option.
        option: Arc<OptionNode>,
        /// The text before the value in the same word, such as `--file=`.
        lead: String,
        /// The partial value.
        prefix: String,
    },
    /// An argument's value.
    Argument {
        /// The Command routing reached.
        command: Arc<CommandNode>,
        /// The words the earlier part of the invocation gave its inputs.
        typed: TypedInputs,
        /// The argument.
        argument: Arc<ArgumentNode>,
        /// The partial word.
        prefix: String,
    },
    /// A word after `--` on a Command that declares passthrough.
    Passthrough {
        /// The Command routing reached.
        command: Arc<CommandNode>,
        /// The words the earlier part of the invocation gave its inputs.
        typed: TypedInputs,
        /// The partial word.
        prefix: String,
    },
    /// No position: the words cannot continue.
    None,
}

/// Locates the last of `words` with the grammar the run uses, so a completion candidate never
/// disagrees with the parser.
///
/// It never fails. Only `inspect()` builds a [`CommandGraph`], which carries the parser's tables, and
/// a clone shares them, so the reference's `foreign-graph` fault for a graph `inspect()` did not
/// return is unreachable.
///
/// `words` holds the tokens after the application name; an empty list reads as one empty word. It
/// runs no validator, input source, or middleware, and a structural fault among the earlier words,
/// an unknown Command included, reads as [`WordPosition::None`].
#[must_use]
pub fn locate(graph: &CommandGraph, words: &[&str]) -> WordPosition {
    let (last, earlier) = words
        .split_last()
        .map_or(("", &[][..]), |(last, earlier)| (*last, earlier));
    let earlier: Vec<String> = earlier.iter().map(|word| (*word).to_owned()).collect();
    let Ok(read) = parse::read_words(&graph.link.grammar, &earlier, true) else {
        return WordPosition::None;
    };
    if read.fault.is_some() {
        return WordPosition::None;
    }
    Scope {
        graph,
        command: Arc::clone(&read.command.node),
        earlier: &read,
    }
    .last_word(last)
}

/// What the last word is read against: the inspected graph, its routed node, and the earlier words.
struct Scope<'a, 'g> {
    graph: &'a CommandGraph,
    command: Arc<CommandNode>,
    earlier: &'a parse::WordsRead<'g>,
}

impl Scope<'_, '_> {
    /// The last word, read as the parser would read the next word.
    fn last_word(&self, last: &str) -> WordPosition {
        let earlier = self.earlier;
        if earlier.delimited {
            if self.command.passthrough.is_none() {
                return self.plain_word(last);
            }
            return WordPosition::Passthrough {
                command: Arc::clone(&self.command),
                typed: self.earlier.typed_inputs(),
                prefix: last.to_owned(),
            };
        }
        if let Some(awaiting) = &earlier.awaiting {
            if parse::refuses_value(last) {
                return WordPosition::None;
            }
            return self.value_of(&awaiting.name, "", last);
        }
        if last == "-" || last == "--" {
            return self.option_position(last);
        }
        if parse::is_option_word(last) {
            // A long spelling without `=` is still being typed, so it is an option spelling whatever
            // it names; any other word is read by the walk.
            let typing = last.starts_with("--") && !last.contains('=');
            let carried = if typing {
                None
            } else {
                self.carried_value(last)
            };
            return carried.unwrap_or_else(|| self.option_position(last));
        }
        self.plain_word(last)
    }

    /// The value position of one option in scope: a global, or the routed Command's own.
    fn value_of(&self, name: &str, lead: &str, prefix: &str) -> WordPosition {
        let option = self
            .graph
            .globals
            .iter()
            .chain(&self.command.options)
            .find(|option| option.name() == name);
        // Build published every option the parser reads, so every name is found.
        option.map_or(WordPosition::None, |option| WordPosition::Value {
            command: Arc::clone(&self.command),
            typed: self.earlier.typed_inputs(),
            option: Arc::clone(option),
            lead: lead.to_owned(),
            prefix: prefix.to_owned(),
        })
    }

    /// A plain word names a child until routing ends, and fills the next positional after.
    fn plain_word(&self, last: &str) -> WordPosition {
        let earlier = self.earlier;
        if !earlier.delimited && !earlier.committed && !earlier.command.children.is_empty() {
            return WordPosition::Command {
                argument: self.command.arguments.first().cloned(),
                command: Arc::clone(&self.command),
                typed: self.earlier.typed_inputs(),
                prefix: last.to_owned(),
            };
        }
        parse::argument_slot(&earlier.command.arguments, earlier.positionals.len())
            .and_then(|(index, _)| self.command.arguments.get(index))
            .map_or(WordPosition::None, |argument| WordPosition::Argument {
                command: Arc::clone(&self.command),
                typed: self.earlier.typed_inputs(),
                argument: Arc::clone(argument),
                prefix: last.to_owned(),
            })
    }

    /// A word the walk reads against the routed Command's table and the earlier words' values: no
    /// position where the walk faults, a repeat of an earlier option included, the value a long
    /// spelling carries after `=` or a short value letter carries after it, and otherwise `None`, an
    /// option spelling.
    fn carried_value(&self, last: &str) -> Option<WordPosition> {
        for occurrence in parse::read_last_word(self.earlier, last) {
            match occurrence {
                parse::Occurrence::Value {
                    option,
                    lead: Some(lead),
                    ..
                } => return Some(self.value_of(&option.name, &lead, &last[lead.len()..])),
                parse::Occurrence::Value { .. } | parse::Occurrence::Awaiting { .. } => {}
                _ => return Some(WordPosition::None),
            }
        }
        None
    }

    /// The option position of a last word: the names the earlier words supplied, how many times
    /// they supplied each counted option, and the value they gave each Boolean option, a held-back
    /// own option's included.
    fn option_position(&self, last: &str) -> WordPosition {
        let values = &self.earlier.values;
        let mut booleans: Vec<(String, bool)> = Vec::new();
        for (name, value) in values
            .globals
            .booleans
            .iter()
            .chain(&values.locals.booleans)
            .chain(&self.earlier.held_booleans)
        {
            merge(&mut booleans, name, *value);
        }
        let mut counts: Vec<(String, u32)> = Vec::new();
        for (name, count) in values.globals.counts.iter().chain(&values.locals.counts) {
            merge(&mut counts, name, *count);
        }
        WordPosition::Option {
            command: Arc::clone(&self.command),
            typed: self.earlier.typed_inputs(),
            prefix: last.to_owned(),
            supplied: self.earlier.supplied.clone(),
            counts,
            booleans,
        }
    }
}

/// Sets `name` in an insertion-ordered list: a later value replaces an earlier one in its place.
fn merge<T>(entries: &mut Vec<(String, T)>, name: &str, value: T) {
    match entries.iter_mut().find(|(known, _)| known == name) {
        Some((_, slot)) => *slot = value,
        None => entries.push((name.to_owned(), value)),
    }
}

/// The spelling a problem names an option by: its long form, else a negative-only Boolean option's
/// negative form, else its short form.
#[must_use]
pub fn reported_spelling(option: &OptionNode) -> String {
    let negative = match option {
        OptionNode::Boolean(node) => node.negative.as_deref(),
        _ => None,
    };
    option
        .long()
        .or(negative)
        .or_else(|| option.short())
        .map_or_else(|| format!("--{}", option.name()), str::to_owned)
}

#[cfg(test)]
mod tests {
    use super::with_schema_dialect;

    fn object(text: &str) -> serde_json::Map<String, serde_json::Value> {
        match serde_json::from_str(text) {
            Ok(serde_json::Value::Object(map)) => map,
            _ => panic!("not a JSON object: {text}"),
        }
    }

    #[test]
    fn the_dialect_member_leads_the_published_schema() {
        let published = with_schema_dialect(object(r#"{"type":"string","minLength":1}"#));
        assert_eq!(
            serde_json::to_string(&published).ok().as_deref(),
            Some(
                r#"{"$schema":"https://json-schema.org/draft/2020-12/schema","type":"string","minLength":1}"#
            ),
        );
    }

    #[test]
    fn a_schema_of_its_own_keeps_the_first_place_with_its_value() {
        let published = with_schema_dialect(object(r#"{"type":"string","$schema":"x"}"#));
        assert_eq!(
            serde_json::to_string(&published).ok().as_deref(),
            Some(r#"{"$schema":"x","type":"string"}"#),
        );
    }
}
