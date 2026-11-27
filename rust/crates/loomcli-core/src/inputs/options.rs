//! Option builders: string, Boolean, counted, and content options.
//!
//! Each kind has its own builder, so a setter a kind does not take does not exist on it: a counted
//! option has no `validate`, a Boolean option no `default`. A combination one builder cannot rule
//! out by its methods, such as `required` beside `default`, is a declaration fault at the call that
//! receives the builder: `option()`, `global_option()`, or a plugin's `option()`.

use std::sync::Arc;

use crate::diagnostics::Literal;
use crate::plugins::{ExtensionValue, OptionTarget};

use super::{OmissionValidator, Validator, messages};

/// Which spellings a Boolean option accepts.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Polarity {
    /// `--name` sets it.
    #[default]
    Positive,
    /// `--no-name` sets it to false; there is no positive spelling.
    Negative,
    /// Both `--name` and `--no-name`.
    Both,
}

/// A declared default in the validator's input type, with one raw string per word. Each word
/// passes through the validator as a supplied word would.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum DefaultValue {
    /// One raw value.
    One(String),
    /// Raw values of a multiple option or a variadic argument.
    Many(Vec<String>),
    /// Groups of raw words, one per occurrence of a multiple arity option.
    Tuples(Vec<Vec<String>>),
}

impl From<&str> for DefaultValue {
    fn from(value: &str) -> Self {
        DefaultValue::One(value.to_owned())
    }
}

impl From<String> for DefaultValue {
    fn from(value: String) -> Self {
        DefaultValue::One(value)
    }
}

impl<const N: usize> From<[&str; N]> for DefaultValue {
    fn from(values: [&str; N]) -> Self {
        DefaultValue::Many(values.iter().map(|value| (*value).to_owned()).collect())
    }
}

impl From<Vec<String>> for DefaultValue {
    fn from(values: Vec<String>) -> Self {
        DefaultValue::Many(values)
    }
}

impl<const N: usize, const M: usize> From<[[&str; N]; M]> for DefaultValue {
    fn from(values: [[&str; N]; M]) -> Self {
        Self::Tuples(values.map(|words| words.map(str::to_owned).into()).into())
    }
}

impl From<Vec<Vec<String>>> for DefaultValue {
    fn from(values: Vec<Vec<String>>) -> Self {
        Self::Tuples(values)
    }
}

/// One validated value with its type erased: the validator's output, or the string itself.
pub(crate) type ErasedOutput = Arc<dyn std::any::Any + Send + Sync>;

/// A validator's verdict on one value, its output erased.
pub(crate) type ErasedVerdict = Result<ErasedOutput, Vec<super::Issue>>;

type JudgeFn = Arc<dyn Fn(&str, &super::ValidationContext) -> ErasedVerdict + Send + Sync>;
type OmissionFn = Arc<dyn Fn(&super::ValidationContext) -> ErasedVerdict + Send + Sync>;

/// A validator with its output type erased, as a declaration stores it: the call that judges one
/// string, and for a validator that judges omission too, the call that judges it.
#[derive(Clone)]
pub(crate) struct ErasedValidator {
    judge: JudgeFn,
    pub(crate) pack: fn(&[ErasedOutput]) -> Option<ErasedOutput>,
    omission: Option<OmissionFn>,
    /// The input schema the validator publishes, read once at the declaring call.
    pub(crate) schema: crate::inspection::InputSchema,
}

impl ErasedValidator {
    /// `validator`, erased.
    pub(crate) fn new<V: Validator>(validator: V) -> Self {
        Self::new_shared(Arc::new(validator))
    }

    /// `validator`, erased with its omission call.
    pub(crate) fn omitting<V: OmissionValidator>(validator: V) -> Self {
        let validator = Arc::new(validator);
        let judging = Arc::clone(&validator);
        let mut erased = Self::new_shared(judging);
        erased.omission = Some(Arc::new(move |context| {
            validator
                .validate_omission(context)
                .map(|output| Arc::new(output) as ErasedOutput)
        }));
        erased
    }

    /// A shared validator, erased without its omission call.
    fn new_shared<V: Validator>(validator: Arc<V>) -> Self {
        let schema = validator.input_schema();
        Self {
            judge: Arc::new(move |input, context| {
                validator
                    .validate(input, context)
                    .map(|output| Arc::new(output) as ErasedOutput)
            }),
            pack: |outputs| {
                let words = outputs
                    .iter()
                    .map(|output| output.downcast_ref::<V::Output>().cloned())
                    .collect::<Option<Vec<_>>>()?;
                Some(Arc::new(words))
            },
            omission: None,
            schema,
        }
    }

    /// Judges one string.
    pub(crate) fn validate(
        &self,
        input: &str,
        context: &super::ValidationContext,
    ) -> ErasedVerdict {
        (self.judge)(input, context)
    }

    /// Judges the omission, for a validator declared through `validate_omitted`.
    pub(crate) fn validate_omission(
        &self,
        context: &super::ValidationContext,
    ) -> Option<ErasedVerdict> {
        self.omission.as_ref().map(|judge| judge(context))
    }
}

/// The facts every option kind shares.
#[derive(Clone, Default)]
pub(crate) struct OptionFacts {
    pub(crate) description: Option<String>,
    pub(crate) hidden: bool,
    pub(crate) deprecated: Option<String>,
    pub(crate) control: bool,
    pub(crate) short: Option<char>,
    pub(crate) short_only: bool,
    pub(crate) aliases: Vec<String>,
    pub(crate) visible_aliases: Vec<String>,
    pub(crate) env: Vec<String>,
    pub(crate) extensions: Vec<ExtensionValue<OptionTarget>>,
    /// The setters called, in call order, for the builder chain a finding prints.
    pub(crate) chain: Vec<(&'static str, Vec<Literal>)>,
}

/// The two lists an option can declare aliases in, in the order Loom checks them.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum AliasList {
    Unadvertised,
    Visible,
}

impl AliasList {
    pub(super) const ALL: [Self; 2] = [Self::Unadvertised, Self::Visible];

    pub(super) fn names(self, facts: &OptionFacts) -> &[String] {
        match self {
            Self::Unadvertised => &facts.aliases,
            Self::Visible => &facts.visible_aliases,
        }
    }

    pub(super) const fn setter(self) -> &'static str {
        match self {
            Self::Unadvertised => "aliases",
            Self::Visible => "visible_aliases",
        }
    }
}

impl OptionFacts {
    /// Records a setter call for the printed chain, replacing an earlier call of the same setter.
    pub(crate) fn called(&mut self, setter: &'static str, arguments: Vec<Literal>) {
        self.chain.retain(|(known, _)| *known != setter);
        self.chain.push((setter, arguments));
    }
}

/// The constructors of the option builders.
pub struct Opt;

impl Opt {
    /// A string option: one value, or several with [`StringOpt::multiple`].
    pub fn string() -> StringOpt {
        <StringOpt as Default>::default()
    }

    /// A Boolean option.
    pub fn boolean() -> BooleanOpt {
        BooleanOpt::default()
    }

    /// A counted option: each occurrence adds one.
    pub fn count() -> CountOpt {
        CountOpt::default()
    }

    /// A content option: a file path, or `-` and piped stdin with [`ContentOpt::stdin`].
    pub fn content() -> ContentOpt {
        ContentOpt::default()
    }
}

macro_rules! shared_option_setters {
    () => {
        /// Sets the description every projection reads.
        pub fn description(mut self, text: impl Into<String>) -> Self {
            let text = text.into();
            self.facts.called("description", vec![text.as_str().into()]);
            self.facts.description = Some(text);
            self
        }

        /// Keeps the option off every listing; it still parses.
        pub fn hidden(mut self) -> Self {
            self.facts.called("hidden", Vec::new());
            self.facts.hidden = true;
            self
        }

        /// Marks the option deprecated, with the migration message a projection prints beside it.
        pub fn deprecated(mut self, message: impl Into<String>) -> Self {
            let message = message.into();
            self.facts
                .called("deprecated", vec![message.as_str().into()]);
            self.facts.deprecated = Some(message);
            self
        }

        /// Marks the option as one that controls the invocation, such as `--help`. Core never reads
        /// the mark; projections such as MCP do.
        pub fn control(mut self) -> Self {
            self.facts.called("control", Vec::new());
            self.facts.control = true;
            self
        }

        /// Sets the short spelling, one ASCII letter. Another character is a fault at the call that
        /// receives the builder, under `option-config`.
        pub fn short(mut self, letter: char) -> Self {
            self.facts.called("short", vec![letter.into()]);
            self.facts.short = Some(letter);
            self
        }

        /// Makes the short spelling the only one: the option has no long spelling and no aliases.
        pub fn short_only(mut self) -> Self {
            self.facts.called("short_only", Vec::new());
            self.facts.short_only = true;
            self
        }

        /// Declares unadvertised long synonyms.
        pub fn aliases(mut self, aliases: impl IntoIterator<Item = impl Into<String>>) -> Self {
            let aliases: Vec<String> = aliases.into_iter().map(Into::into).collect();
            self.facts
                .called("aliases", vec![Literal::from(aliases.clone())]);
            self.facts.aliases = aliases;
            self
        }

        /// Sets the visible long aliases, as bare names, in the order declared.
        /// A name also in `aliases` keeps its place there and becomes visible.
        /// A short-only option accepts an empty list.
        pub fn visible_aliases(
            mut self,
            aliases: impl IntoIterator<Item = impl Into<String>>,
        ) -> Self {
            let aliases: Vec<String> = aliases.into_iter().map(Into::into).collect();
            self.facts
                .called("visible_aliases", vec![Literal::from(aliases.clone())]);
            self.facts.visible_aliases = aliases;
            self
        }

        /// Attaches extension values, such as a help placeholder.
        pub fn extend(
            mut self,
            values: impl crate::IntoList<ExtensionValue<OptionTarget>>,
        ) -> Self {
            let values = values.into_list();
            self.facts.called(
                "extend",
                vec![crate::plugins::extension_values_literal(values.len())],
            );
            self.facts.extensions = values;
            self
        }
    };
}

macro_rules! env_setter {
    () => {
        /// Binds environment variables, read in order; the first that is set fills the option. A
        /// variable named twice binds once.
        pub fn env(mut self, names: impl IntoIterator<Item = impl Into<String>>) -> Self {
            let mut variables: Vec<String> = Vec::new();
            for name in names {
                let name = name.into();
                if !variables.contains(&name) {
                    variables.push(name);
                }
            }
            self.facts
                .called("env", vec![Literal::from(variables.clone())]);
            self.facts.env = variables;
            self
        }
    };
}

/// A string option builder.
#[derive(Clone, Default)]
#[must_use]
pub struct StringOpt {
    pub(crate) facts: OptionFacts,
    pub(crate) required: bool,
    pub(crate) required_non_interactive: bool,
    pub(crate) multiple: bool,
    pub(crate) last_wins: bool,
    pub(crate) arity: Option<usize>,
    pub(crate) default: Option<DefaultValue>,
    pub(crate) implied: Option<String>,
    pub(crate) validator: Option<ErasedValidator>,
    pub(crate) validate_omitted: bool,
    pub(crate) env_delimiter: Option<String>,
    pub(crate) env_allow_empty: bool,
    pub(crate) background: bool,
}

impl StringOpt {
    shared_option_setters!();
    env_setter!();

    /// Makes the option required: present, or for a multiple option at least one value.
    pub fn required(mut self) -> Self {
        self.facts.called("required", Vec::new());
        self.required = true;
        self
    }

    /// Makes the option required only when the run cannot ask the operator.
    pub fn required_when_non_interactive(mut self) -> Self {
        self.facts
            .called("required_when_non_interactive", Vec::new());
        self.required_non_interactive = true;
        self
    }

    /// Accepts the option several times; the action reads a list.
    pub fn multiple(mut self) -> Self {
        self.facts.called("multiple", Vec::new());
        self.multiple = true;
        self
    }

    /// Takes exactly `words` separate words per occurrence. The declaring call requires at least two.
    pub fn arity(mut self, words: usize) -> Self {
        self.facts
            .called("arity", vec![Literal::from(words as f64)]);
        self.arity = Some(words);
        self
    }

    /// Keeps the last occurrence across all accepted spellings of a scalar string option.
    pub fn last_wins(mut self) -> Self {
        self.facts.called("last_wins", Vec::new());
        self.last_wins = true;
        self
    }

    /// Declares the default, a raw value in the validator's input type.
    pub fn default(mut self, value: impl Into<DefaultValue>) -> Self {
        let value = value.into();
        self.facts.called("default", vec![value.literal()]);
        self.default = Some(value);
        self
    }

    /// Declares the implied value a bare spelling supplies; the option then never takes the next word.
    pub fn implied(mut self, value: impl Into<String>) -> Self {
        let value = value.into();
        self.facts.called("implied", vec![value.as_str().into()]);
        self.implied = Some(value);
        self
    }

    /// Validates each value with `validator`; the action reads its output.
    pub fn validate<V: Validator>(mut self, validator: V) -> Self {
        self.facts.called("validate", vec![Literal::Opaque]);
        self.facts
            .chain
            .retain(|(setter, _)| *setter != "validate_omitted");
        self.validator = Some(ErasedValidator::new(validator));
        self.validate_omitted = false;
        self
    }

    /// Validates each value with `validator`, and sends the option's omission to it too.
    pub fn validate_omitted<V: OmissionValidator>(mut self, validator: V) -> Self {
        self.facts.called("validate_omitted", vec![Literal::Opaque]);
        self.facts.chain.retain(|(setter, _)| *setter != "validate");
        self.validator = Some(ErasedValidator::omitting(validator));
        self.validate_omitted = true;
        self
    }

    /// Splits the environment value of a multiple option or a scalar arity option at `delimiter`.
    pub fn env_delimiter(mut self, delimiter: impl Into<String>) -> Self {
        let delimiter = delimiter.into();
        self.facts
            .called("env_delimiter", vec![delimiter.as_str().into()]);
        self.env_delimiter = Some(delimiter);
        self
    }

    /// Lets an empty environment value fill the option instead of reading as unset.
    pub fn env_allow_empty(mut self) -> Self {
        self.facts.called("env_allow_empty", Vec::new());
        self.env_allow_empty = true;
        self
    }

    /// Marks the global option that states the terminal's background.
    pub fn background(mut self) -> Self {
        self.facts.called("background", Vec::new());
        self.background = true;
        self
    }
}

/// A Boolean option builder.
#[derive(Clone, Default)]
#[must_use]
pub struct BooleanOpt {
    pub(crate) facts: OptionFacts,
    pub(crate) polarity: Polarity,
    pub(crate) interaction: bool,
    pub(crate) color: bool,
    pub(crate) plain: bool,
}

impl BooleanOpt {
    shared_option_setters!();
    env_setter!();

    /// Sets which spellings the option accepts.
    pub fn polarity(mut self, polarity: Polarity) -> Self {
        self.facts.called("polarity", vec![polarity.literal()]);
        self.polarity = polarity;
        self
    }

    /// Marks the global option that turns questions off for a run.
    pub fn interaction(mut self) -> Self {
        self.facts.called("interaction", Vec::new());
        self.interaction = true;
        self
    }

    /// Marks the global option that carries the operator's color choice.
    pub fn color(mut self) -> Self {
        self.facts.called("color", Vec::new());
        self.color = true;
        self
    }

    /// Marks the global option whose positive long spellings turn the run's plain switch on.
    pub fn plain(mut self) -> Self {
        self.facts.called("plain", Vec::new());
        self.plain = true;
        self
    }
}

/// A counted option builder.
#[derive(Clone, Default)]
#[must_use]
pub struct CountOpt {
    pub(crate) facts: OptionFacts,
    pub(crate) verbose: bool,
    pub(crate) quiet: bool,
}

impl CountOpt {
    shared_option_setters!();
    env_setter!();

    /// Marks the global option that raises the run's verbosity.
    pub fn verbose(mut self) -> Self {
        self.facts.called("verbose", Vec::new());
        self.verbose = true;
        self
    }

    /// Marks the global option that lowers the run's verbosity.
    pub fn quiet(mut self) -> Self {
        self.facts.called("quiet", Vec::new());
        self.quiet = true;
        self
    }
}

/// A content option builder: a file path, or piped stdin.
#[derive(Clone, Default)]
#[must_use]
pub struct ContentOpt {
    pub(crate) facts: OptionFacts,
    pub(crate) required: bool,
    pub(crate) multiple: bool,
    pub(crate) stdin: bool,
    pub(crate) min: Option<usize>,
    pub(crate) max: Option<usize>,
    pub(crate) env_delimiter: Option<String>,
}

impl ContentOpt {
    shared_option_setters!();
    env_setter!();

    /// Makes the option required: present, or for a multiple option at least one source.
    pub fn required(mut self) -> Self {
        self.facts.called("required", Vec::new());
        self.required = true;
        self
    }

    /// Accepts the option several times; the action reads a list of contents.
    pub fn multiple(mut self) -> Self {
        self.facts.called("multiple", Vec::new());
        self.multiple = true;
        self
    }

    /// Reads piped stdin when the option is omitted, or supplied as `-`.
    pub fn stdin(mut self) -> Self {
        self.facts.called("stdin", Vec::new());
        self.stdin = true;
        self
    }

    /// The fewest sources a multiple option accepts.
    pub fn min(mut self, count: usize) -> Self {
        self.facts.called("min", vec![Literal::from(count as f64)]);
        self.min = Some(count);
        self
    }

    /// The most sources a multiple option accepts.
    pub fn max(mut self, count: usize) -> Self {
        self.facts.called("max", vec![Literal::from(count as f64)]);
        self.max = Some(count);
        self
    }

    /// Splits a multiple option's environment value at `delimiter`.
    pub fn env_delimiter(mut self, delimiter: impl Into<String>) -> Self {
        let delimiter = delimiter.into();
        self.facts
            .called("env_delimiter", vec![delimiter.as_str().into()]);
        self.env_delimiter = Some(delimiter);
        self
    }
}

/// An option declaration of any kind, as `option()` takes it.
#[derive(Clone)]
#[non_exhaustive]
pub enum OptionDecl {
    /// A string option.
    String(StringOpt),
    /// A Boolean option.
    Boolean(BooleanOpt),
    /// A counted option.
    Count(CountOpt),
    /// A content option.
    Content(ContentOpt),
}

impl From<StringOpt> for OptionDecl {
    fn from(option: StringOpt) -> Self {
        OptionDecl::String(option)
    }
}

impl From<BooleanOpt> for OptionDecl {
    fn from(option: BooleanOpt) -> Self {
        OptionDecl::Boolean(option)
    }
}

impl From<CountOpt> for OptionDecl {
    fn from(option: CountOpt) -> Self {
        OptionDecl::Count(option)
    }
}

impl From<ContentOpt> for OptionDecl {
    fn from(option: ContentOpt) -> Self {
        OptionDecl::Content(option)
    }
}

/// A global option declaration, as `global_option()` and a plugin's `option()` take it.
///
/// A content option stays local to its Command, so `ContentOpt` has no conversion into it; a
/// presence rule on a string option (`required`, `validate_omitted`) is a fault at the call.
#[derive(Clone)]
pub struct GlobalOptionDecl(pub(crate) OptionDecl);

impl From<StringOpt> for GlobalOptionDecl {
    fn from(option: StringOpt) -> Self {
        GlobalOptionDecl(OptionDecl::String(option))
    }
}

impl From<BooleanOpt> for GlobalOptionDecl {
    fn from(option: BooleanOpt) -> Self {
        GlobalOptionDecl(OptionDecl::Boolean(option))
    }
}

impl From<CountOpt> for GlobalOptionDecl {
    fn from(option: CountOpt) -> Self {
        GlobalOptionDecl(OptionDecl::Count(option))
    }
}

impl Polarity {
    /// The value as a finding prints it.
    pub(crate) fn literal(self) -> Literal {
        Literal::builder(match self {
            Polarity::Positive => "Polarity::Positive",
            Polarity::Negative => "Polarity::Negative",
            Polarity::Both => "Polarity::Both",
        })
    }
}

impl DefaultValue {
    /// The value as a finding prints it.
    pub(crate) fn literal(&self) -> Literal {
        match self {
            DefaultValue::One(value) => value.as_str().into(),
            DefaultValue::Many(values) => Literal::from(values.clone()),
            DefaultValue::Tuples(values) => Literal::from(values.clone()),
        }
    }

    /// The value as the graph publishes it.
    pub(crate) fn json(&self) -> serde_json::Value {
        match self {
            DefaultValue::One(value) => serde_json::Value::from(value.as_str()),
            DefaultValue::Many(values) => serde_json::Value::from(values.clone()),
            DefaultValue::Tuples(values) => serde_json::Value::from(values.clone()),
        }
    }
}

impl OptionDecl {
    /// The facts every option kind shares.
    pub(crate) fn facts(&self) -> &OptionFacts {
        match self {
            OptionDecl::String(option) => &option.facts,
            OptionDecl::Boolean(option) => &option.facts,
            OptionDecl::Count(option) => &option.facts,
            OptionDecl::Content(option) => &option.facts,
        }
    }

    /// The shared facts, to adjust.
    pub(crate) fn facts_mut(&mut self) -> &mut OptionFacts {
        match self {
            OptionDecl::String(option) => &mut option.facts,
            OptionDecl::Boolean(option) => &mut option.facts,
            OptionDecl::Count(option) => &mut option.facts,
            OptionDecl::Content(option) => &mut option.facts,
        }
    }

    /// The builder chain a finding prints: the constructor and each setter called.
    pub(crate) fn literal(&self) -> Literal {
        let start = match self {
            OptionDecl::String(_) => "Opt::string()",
            OptionDecl::Boolean(_) => "Opt::boolean()",
            OptionDecl::Count(_) => "Opt::count()",
            OptionDecl::Content(_) => "Opt::content()",
        };
        self.facts()
            .chain
            .iter()
            .fold(Literal::builder(start), |chain, (setter, arguments)| {
                chain.call(*setter, arguments.clone())
            })
    }

    /// Whether the option is a Boolean option whose negative spelling is its only one.
    pub(crate) fn polarity(&self) -> Option<Polarity> {
        match self {
            OptionDecl::Boolean(option) => Some(option.polarity),
            _ => None,
        }
    }

    /// The count of separate words in one occurrence of an arity option.
    pub(crate) fn arity(&self) -> Option<usize> {
        match self {
            OptionDecl::String(option) => option.arity,
            _ => None,
        }
    }

    /// Whether the latest argv occurrence replaces earlier ones.
    pub(crate) fn last_wins(&self) -> bool {
        matches!(self, OptionDecl::String(option) if option.last_wins)
    }

    /// Whether it collects several values.
    pub(crate) fn multiple(&self) -> bool {
        match self {
            OptionDecl::String(option) => option.multiple,
            OptionDecl::Content(option) => option.multiple,
            _ => false,
        }
    }

    /// Whether it is a content option that claims stdin.
    pub(crate) fn claims_stdin(&self) -> bool {
        matches!(self, OptionDecl::Content(option) if option.stdin)
    }

    /// Whether a member of an exclusive group with this declaration could never be left out.
    pub(crate) fn requires_presence(&self) -> bool {
        match self {
            OptionDecl::Content(option) => option.required || option.min.unwrap_or(0) > 0,
            OptionDecl::String(option) => option.required || option.required_non_interactive,
            _ => false,
        }
    }

    /// The run-wide marks it carries, by fact name.
    pub(crate) fn marks(&self) -> Vec<&'static str> {
        let mut marks = Vec::new();
        match self {
            OptionDecl::String(option) => {
                if option.background {
                    marks.push("background");
                }
            }
            OptionDecl::Boolean(option) => {
                if option.interaction {
                    marks.push("interaction");
                }
                if option.color {
                    marks.push("color");
                }
                if option.plain {
                    marks.push("plain");
                }
            }
            OptionDecl::Count(option) => {
                if option.verbose {
                    marks.push("verbose");
                }
                if option.quiet {
                    marks.push("quiet");
                }
            }
            OptionDecl::Content(_) => {}
        }
        marks
    }

    /// The first pair of facts this one builder combines that exclude each other, as the setter
    /// that breaks the rule and the sentence's reason, judged for a local option or a global one.
    pub(crate) fn config_conflict(&self, global: bool) -> Option<(&'static str, String)> {
        let facts = self.facts();
        if let Some(letter) = facts.short
            && !letter.is_ascii_alphabetic()
        {
            return Some((
                "short",
                "declares a short spelling that is not one ASCII letter".to_owned(),
            ));
        }
        if facts.short_only && facts.short.is_none() {
            return Some((
                "short_only",
                "declares short_only without a short spelling".to_owned(),
            ));
        }
        if facts.short_only
            && let Some(list) = AliasList::ALL
                .into_iter()
                .find(|list| !list.names(facts).is_empty())
        {
            let setter = list.setter();
            return Some((setter, messages::aliases_beside_short_only(setter)));
        }
        if !global && let Some(mark) = self.marks().first() {
            return Some((
                mark,
                format!(
                    "declares {mark} on a local option; only a global option carries a run-wide mark"
                ),
            ));
        }
        match self {
            OptionDecl::String(option) => string_conflict(option, global),
            OptionDecl::Boolean(option) => {
                if option.polarity == Polarity::Both && facts.short_only {
                    return Some(("short_only", "declares short_only beside polarity both, which one short spelling cannot express".to_owned()));
                }
                if option.color && facts.short.is_some() {
                    return Some(("short", "declares color beside a short spelling".to_owned()));
                }
                if option.color && !facts.env.is_empty() {
                    return Some((
                        "env",
                        "declares color beside an environment binding".to_owned(),
                    ));
                }
                if option.plain {
                    if option.color {
                        return Some(("plain", "declares both color and plain".to_owned()));
                    }
                    if option.interaction {
                        return Some(("plain", "declares both interaction and plain".to_owned()));
                    }
                    if option.polarity != Polarity::Positive {
                        return Some((
                            "polarity",
                            "declares plain with a polarity other than positive".to_owned(),
                        ));
                    }
                    if facts.short.is_some() {
                        return Some((
                            "short",
                            "declares plain beside a short spelling".to_owned(),
                        ));
                    }
                    if !facts.env.is_empty() {
                        return Some((
                            "env",
                            "declares plain beside an environment binding".to_owned(),
                        ));
                    }
                }
                None
            }
            OptionDecl::Count(option) => {
                if option.verbose && option.quiet {
                    return Some(("quiet", "declares both verbose and quiet".to_owned()));
                }
                if (option.verbose || option.quiet) && !facts.env.is_empty() {
                    let mark = if option.verbose { "verbose" } else { "quiet" };
                    return Some((
                        "env",
                        format!("declares {mark} beside an environment binding"),
                    ));
                }
                None
            }
            OptionDecl::Content(option) => {
                if !option.multiple && (option.min.is_some() || option.max.is_some()) {
                    let setter = if option.min.is_some() { "min" } else { "max" };
                    return Some((setter, format!("declares {setter} without multiple")));
                }
                list_binding_conflict(option.multiple, &facts.env, option.env_delimiter.as_ref())
            }
        }
    }
}

/// The conflicts of a string option's own facts.
fn string_conflict(option: &StringOpt, global: bool) -> Option<(&'static str, String)> {
    let facts = &option.facts;
    if option.multiple && option.last_wins {
        return Some(("last_wins", "declares last_wins beside multiple".to_owned()));
    }
    if global && option.required {
        return Some((
            "required",
            "declares required on a global option, which declares no presence rule".to_owned(),
        ));
    }
    if global && option.required_non_interactive {
        return Some(("required_when_non_interactive", "declares required_when_non_interactive on a global option, which declares no presence rule".to_owned()));
    }
    if global && option.validate_omitted {
        return Some((
            "validate_omitted",
            "declares validate_omitted on a global option, which declares no presence rule"
                .to_owned(),
        ));
    }
    if option.required && option.required_non_interactive {
        return Some((
            "required_when_non_interactive",
            "declares both required and required_when_non_interactive".to_owned(),
        ));
    }
    if (option.required || option.required_non_interactive) && option.default.is_some() {
        return Some(("default", "declares a default beside required".to_owned()));
    }
    if option.validate_omitted {
        for (present, setter) in [
            (
                option.required || option.required_non_interactive,
                "required",
            ),
            (option.default.is_some(), "default"),
            (option.multiple, "multiple"),
        ] {
            if present {
                return Some((
                    "validate_omitted",
                    format!("declares validate_omitted beside {setter}"),
                ));
            }
        }
    }
    if let Some(arity) = option.arity {
        for (present, setter) in [
            (option.implied.is_some(), "implied"),
            (option.validate_omitted, "validate_omitted"),
            (option.background, "background"),
            (option.env_allow_empty, "env_allow_empty"),
        ] {
            if present {
                return Some((setter, format!("declares {setter} beside arity")));
            }
        }
        if !facts.env.is_empty() {
            if option.multiple {
                return Some((
                    "env",
                    "binds a multiple arity option to the environment".to_owned(),
                ));
            }
            if option.env_delimiter.is_none() {
                return Some((
                    "env",
                    "binds an arity option to the environment without env_delimiter".to_owned(),
                ));
            }
        }
        let default_matches = match &option.default {
            None => true,
            Some(DefaultValue::Many(words)) => !option.multiple && words.len() == arity,
            Some(DefaultValue::Tuples(tuples)) => {
                option.multiple && tuples.iter().all(|words| words.len() == arity)
            }
            Some(DefaultValue::One(_)) => false,
        };
        if !default_matches {
            return Some((
                "default",
                "declares a default whose shape does not match its arity".to_owned(),
            ));
        }
        return list_binding_conflict(!option.multiple, &facts.env, option.env_delimiter.as_ref());
    }
    if matches!(option.default, Some(DefaultValue::Tuples(_))) {
        return Some((
            "default",
            "declares a grouped default without arity".to_owned(),
        ));
    }
    if let Some(DefaultValue::Many(_)) = option.default
        && !option.multiple
    {
        return Some((
            "default",
            "declares a list default on an option that is not multiple".to_owned(),
        ));
    }
    if option.env_allow_empty && (facts.env.is_empty() || option.multiple) {
        return Some((
            "env_allow_empty",
            "declares env_allow_empty without a scalar environment binding".to_owned(),
        ));
    }
    if option.background {
        for (present, setter) in [
            (facts.short.is_some(), "short"),
            (!facts.env.is_empty(), "env"),
            (option.default.is_some(), "default"),
            (option.implied.is_some(), "implied"),
            (option.multiple, "multiple"),
        ] {
            if present {
                return Some((setter, format!("declares background beside {setter}")));
            }
        }
    }
    list_binding_conflict(option.multiple, &facts.env, option.env_delimiter.as_ref())
}

/// The conflicts of an environment binding and its delimiter.
fn list_binding_conflict(
    multiple: bool,
    env: &[String],
    delimiter: Option<&String>,
) -> Option<(&'static str, String)> {
    if delimiter.is_some() && !multiple {
        return Some((
            "env_delimiter",
            "declares env_delimiter on an option that is not multiple".to_owned(),
        ));
    }
    if delimiter.is_some() && env.is_empty() {
        return Some((
            "env_delimiter",
            "declares env_delimiter without an environment binding".to_owned(),
        ));
    }
    if multiple && !env.is_empty() && delimiter.is_none() {
        return Some((
            "env",
            "binds a multiple option to the environment without env_delimiter".to_owned(),
        ));
    }
    None
}
