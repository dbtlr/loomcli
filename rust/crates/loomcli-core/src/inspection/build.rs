//! Graph build: the rules that wait for a finished declaration, and the plain-data graph
//! `inspect()` returns.
//!
//! Build reads an Application's declarations, applies the rules no earlier call could judge, and
//! writes each node in the reference's key order. An Application keeps its successful builds.

use std::sync::{Arc, Mutex, PoisonError};

use crate::application::declaration::ApplicationDeclaration;
use crate::commands::declaration::{
    ArgumentInput, CommandDeclaration, OptionInput, ResultCallKind,
};
use crate::failures::DeclarationError;
use crate::inputs::table::{self, Table, distinct_aliases};
use crate::inputs::{ArgumentDecl, OptionDecl};
use crate::invocation::parse::{Grammar, GrammarCommand, Slot, SpellingTable, table_entries};
use crate::marks::RequiredWhen;
use crate::shipping::ReleaseFacts;

use super::attach::{attach_hooks, judge_graph};

use super::{
    ArgumentNode, BooleanOptionNode, BooleanType, CommandGraph, CommandNode, ContentOptionNode,
    ContentType, CountOptionNode, CountType, DeclaredDefault, InputSchema, OptionNode,
    ResultKindName, ResultNode, StdinNode, StringOptionNode, StringType,
};

/// The version an Application that declares none reads: unversioned.
const UNVERSIONED: &str = "0.0.0";

/// The schema every content input publishes: a nonempty path.
fn content_schema() -> InputSchema {
    let mut schema = serde_json::Map::new();
    schema.insert("minLength".to_owned(), 1.into());
    schema.insert("type".to_owned(), "string".into());
    Some(schema)
}

/// A successful graph for each build mode. The Application owns these slots because the built
/// graph may itself retain the Application's declaration.
#[derive(Default)]
pub(crate) struct KeptGraphs {
    development: Mutex<Option<Arc<CommandGraph>>>,
    distributed: Mutex<Option<Arc<CommandGraph>>>,
}

impl KeptGraphs {
    /// Builds and judges a graph once per mode. Keeping the lock until judgment finishes lets
    /// overlapping runs see the same graph and leaves a faulted slot available for retry.
    pub(crate) fn get(
        &self,
        application: &Arc<ApplicationDeclaration>,
        release: &ReleaseFacts,
    ) -> Result<Arc<CommandGraph>, DeclarationError> {
        let slot = if release.is_development() {
            &self.development
        } else {
            &self.distributed
        };
        let mut kept = slot.lock().unwrap_or_else(PoisonError::into_inner);
        if let Some(graph) = &*kept {
            return Ok(Arc::clone(graph));
        }
        let graph = Arc::new(build(application)?);
        judge_graph(&graph, &application.plugins, &mut Err)?;
        *kept = Some(Arc::clone(&graph));
        Ok(graph)
    }
}

/// Every declaration fault a development run reports before routing, in the order a run meets them.
/// A fault in the build rules ends the build, so the list holds that fault alone; past a built
/// graph, every `on_graph_built` hook judges it, and each one's fault joins the list. The converter
/// check of a development build has no Rust counterpart: a validator's schema is typed
/// (`schema-converter-failed` is unreachable, a recorded deviation).
pub(crate) fn check(application: &Arc<ApplicationDeclaration>) -> Vec<DeclarationError> {
    let graph = match build(application) {
        Ok(graph) => graph,
        Err(fault) => return vec![fault],
    };
    let mut faults = Vec::new();
    let _ = judge_graph(&graph, &application.plugins, &mut |fault| {
        faults.push(fault);
        Ok(())
    });
    faults
}

/// The graph of one build: the plugins' Commands are already attached to the root, and every
/// `on_command_attach` hook runs here, root first and depth first, its contributions meeting the
/// hook rules before the root is judged. The graph's link holds the declaration the hooks left.
fn build(application: &Arc<ApplicationDeclaration>) -> Result<CommandGraph, DeclarationError> {
    let application = &attach_hooks(application)?;
    let root = &application.root;
    root.check_finished(&[], None)?;
    let globals_table = &application.global_table.table;
    let globals = application
        .globals
        .iter()
        .map(|option| Arc::new(option_node(option, globals_table)))
        .collect();
    let globals_entries = table_entries(globals_table, true);
    let (root, grammar) = command_node(
        root,
        Vec::new(),
        Some(application.description.clone()),
        &globals_entries,
    )?;
    Ok(CommandGraph {
        configuration: application
            .configuration
            .as_ref()
            .map(|schema| super::ConfigurationNode {
                schema: schema.clone(),
            }),
        description: application.description.clone(),
        globals,
        name: application.name.clone(),
        root,
        version: application
            .version
            .clone()
            .unwrap_or_else(|| UNVERSIONED.to_owned()),
        build: Some(ReleaseFacts::baked().build),
        link: Arc::new(crate::__private::GraphLink {
            application: Arc::clone(application),
            grammar: Grammar {
                globals: globals_entries,
                root: grammar,
            },
        }),
    })
}

/// One Command's node and the parser's reading of it, and the same for each Command below it. The
/// parser's table is the Command's one table: the global options' spellings, then its own.
fn command_node(
    command: &CommandDeclaration,
    path: Vec<String>,
    description: Option<Option<String>>,
    globals: &SpellingTable,
) -> Result<(Arc<CommandNode>, Arc<GrammarCommand>), DeclarationError> {
    let table = command.local_table(&path)?;
    let mut children = Vec::new();
    let mut grammar_children = Vec::new();
    let mut routes = Vec::new();
    for child in &command.children {
        let name = child.name.clone().unwrap_or_default();
        let mut child_path = path.clone();
        child_path.push(name.clone());
        let (node, grammar) = command_node(child, child_path, None, globals)?;
        let index = grammar_children.len();
        routes.push((name.clone(), index));
        routes.extend(child.aliases.iter().map(|alias| (alias.clone(), index)));
        children.push(node);
        grammar_children.push((name, grammar));
    }
    let mut spellings = globals.clone();
    spellings.extend(table_entries(&table, false));
    let grammar = |node: &Arc<CommandNode>| GrammarCommand {
        table: spellings,
        children: grammar_children,
        routes,
        arguments: command
            .arguments()
            .map(|argument| Slot {
                name: argument.name.clone(),
                variadic: argument.decl.variadic(),
            })
            .collect(),
        action: command.action.clone(),
        hidden: command.hidden,
        deprecated: command.deprecated.is_some(),
        node: Arc::clone(node),
    };
    let (extensions, owners) = command.extensions.publish();
    let node = CommandNode {
        option_groups: command.groups.clone(),
        passthrough: command
            .passthrough
            .as_ref()
            .map(|mode| super::PassthroughNode {
                description: mode.description.clone(),
            }),
        stdin: command.stdin.as_ref().map(|stdin| StdinNode {
            description: stdin.description.clone(),
            required: stdin.required,
        }),
        aliases: command.aliases.clone(),
        arguments: command
            .arguments()
            .map(|argument| Arc::new(argument_node(argument)))
            .collect(),
        children,
        deprecated: command.deprecated.clone(),
        description: description.unwrap_or_else(|| command.description.clone()),
        extensions,
        owners,
        has_action: command.action.is_some(),
        hidden: command.hidden,
        name: command.name.clone(),
        needs_terminal: command.needs_terminal,
        options: command
            .options()
            .map(|option| Arc::new(option_node(option, &table)))
            .collect(),
        path: path.clone(),
        result: result_node(command),
        visible_aliases: command
            .aliases
            .iter()
            .filter(|alias| command.visible_aliases.contains(alias))
            .cloned()
            .collect(),
    };
    let node = Arc::new(node);
    let grammar = Arc::new(grammar(&node));
    Ok((node, grammar))
}

pub(crate) fn result_node(command: &CommandDeclaration) -> Option<ResultNode> {
    let result = command.result()?;
    let mut media_types = serde_json::Map::new();
    for entry in &result.views {
        media_types.insert(
            entry.key.clone(),
            entry
                .media_type
                .clone()
                .map_or(serde_json::Value::Null, serde_json::Value::String),
        );
    }
    Some(ResultNode {
        default: result.default,
        kind: if result.kind == ResultCallKind::Rows {
            ResultKindName::Rows
        } else {
            ResultKindName::Value
        },
        media_types,
        views: result.views.into_iter().map(|entry| entry.key).collect(),
    })
}

fn argument_node(argument: &ArgumentInput) -> ArgumentNode {
    let (extensions, owners) = argument.extensions.publish();
    match &argument.decl {
        ArgumentDecl::String(config) => ArgumentNode {
            max: None,
            min: None,
            stdin: None,
            kind: None,
            default: config.default.as_ref().map(|value| DeclaredDefault {
                value: value.json(),
            }),
            description: config.description.clone(),
            extensions,
            owners,
            name: argument.name.clone(),
            required: config.required,
            required_when: config
                .required_non_interactive
                .then_some(RequiredWhen::NonInteractive),
            schema: config
                .validator
                .as_ref()
                .and_then(|validator| validator.schema.clone()),
            validate_omitted: config.validate_omitted,
            validated: config.validator.is_some(),
            variadic: config.variadic,
        },
        ArgumentDecl::Content(config) => ArgumentNode {
            max: config.max,
            min: config.min,
            stdin: Some(config.stdin),
            kind: Some(ContentType::Content),
            default: None,
            description: config.description.clone(),
            extensions,
            owners,
            name: argument.name.clone(),
            required: config.required || config.min.unwrap_or(0) > 0,
            required_when: None,
            schema: content_schema(),
            validate_omitted: false,
            validated: true,
            variadic: config.variadic,
        },
    }
}

/// One option's node, its spellings read from the table of its scope.
fn option_node(option: &OptionInput, table: &Table) -> OptionNode {
    let [long, negative, short] = table::spellings_of(table, &option.name);
    let facts = option.decl.facts();
    let (extensions, owners) = option.extensions.publish();
    let mut aliases = Vec::new();
    let mut visible_aliases = Vec::new();
    for alias in distinct_aliases(&option.name, &option.decl) {
        aliases.push(alias.name.to_owned());
        if alias.visible() {
            visible_aliases.push(alias.name.to_owned());
        }
    }
    let name = option.name.clone();
    match &option.decl {
        OptionDecl::String(config) => OptionNode::String(StringOptionNode {
            aliases,
            visible_aliases,
            control: facts.control,
            deprecated: facts.deprecated.clone(),
            description: facts.description.clone(),
            env: facts.env.clone(),
            extensions,
            owners,
            hidden: facts.hidden,
            long,
            name,
            short,
            default: config.default.as_ref().map(|value| DeclaredDefault {
                value: value.json(),
            }),
            env_delimiter: config.env_delimiter.clone(),
            implied: config.implied.clone(),
            multiple: config.multiple,
            required: config.required,
            required_when: config
                .required_non_interactive
                .then_some(RequiredWhen::NonInteractive),
            schema: config
                .validator
                .as_ref()
                .and_then(|validator| validator.schema.clone()),
            validate_omitted: config.validate_omitted,
            validated: config.validator.is_some(),
            arity: config.arity,
            background: config.background,
            env_allow_empty: config.env_allow_empty,
            last_wins: config.last_wins,
            kind: StringType::String,
        }),
        OptionDecl::Content(config) => OptionNode::Content(ContentOptionNode {
            aliases,
            visible_aliases,
            control: facts.control,
            deprecated: facts.deprecated.clone(),
            description: facts.description.clone(),
            env: facts.env.clone(),
            extensions,
            owners,
            hidden: facts.hidden,
            long,
            name,
            short,
            default: None,
            env_delimiter: config.env_delimiter.clone(),
            implied: None,
            multiple: config.multiple,
            required: config.required || config.min.unwrap_or(0) > 0,
            required_when: None,
            schema: content_schema(),
            validate_omitted: false,
            validated: true,
            max: config.max,
            min: config.min,
            stdin: config.stdin,
            kind: ContentType::Content,
        }),
        OptionDecl::Boolean(config) => OptionNode::Boolean(BooleanOptionNode {
            aliases,
            visible_aliases,
            control: facts.control,
            deprecated: facts.deprecated.clone(),
            description: facts.description.clone(),
            env: facts.env.clone(),
            extensions,
            owners,
            hidden: facts.hidden,
            long,
            name,
            short,
            color: config.color,
            interaction: config.interaction,
            negative,
            plain: config.plain,
            polarity: config.polarity,
            schema: None,
            kind: BooleanType::Boolean,
        }),
        OptionDecl::Count(config) => OptionNode::Count(CountOptionNode {
            aliases,
            visible_aliases,
            control: facts.control,
            deprecated: facts.deprecated.clone(),
            description: facts.description.clone(),
            env: facts.env.clone(),
            extensions,
            owners,
            hidden: facts.hidden,
            long,
            name,
            short,
            quiet: config.quiet,
            schema: None,
            kind: CountType::Count,
            verbose: config.verbose,
        }),
    }
}
