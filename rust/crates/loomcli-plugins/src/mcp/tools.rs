//! The tool table: which Commands are tools, what each is called, which inputs each lists and
//! how, all derived from the graph where it is read. The build-fault hook and the `mcp` action
//! each derive it, so neither stores what the other read.

use std::sync::Arc;

use loomcli_core::{
    ArgumentNode, CommandGraph, CommandNode, Error, OptionGroup, OptionGroupKind, OptionNode,
    Polarity, RequiredWhen, read_extension,
};
use loomcli_mcp::{Tool, ToolAnnotations};
use serde_json::{Map, Value, json};

use super::extension::{MCP_ARGUMENT, MCP_COMMAND, MCP_INPUT};

/// A JSON Schema as plain data, the form a graph fact and a tool's input schema both take.
type Schema = Map<String, Value>;

/// One input a tool lists under its declared name: an argument, or an option the tool exposes.
#[derive(Clone)]
pub(super) enum Property {
    Argument(Arc<ArgumentNode>),
    Option { node: Arc<OptionNode>, global: bool },
}

impl Property {
    /// The declared name, the property's key.
    pub(super) fn name(&self) -> &str {
        match self {
            Property::Argument(node) => &node.name,
            Property::Option { node, .. } => node.name(),
        }
    }
}

/// One Command that serves a tool, under the tool's name.
#[derive(Clone)]
pub(super) struct ToolEntry {
    pub(super) name: String,
    pub(super) command: Arc<CommandNode>,
}

/// A description or a migration message on one line: each line break an author wrote (CRLF, or
/// one of LF, VT, FF, CR, NEL, LS, PS) reads as one space.
pub(super) fn single_line(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut characters = text.chars().peekable();
    while let Some(character) = characters.next() {
        match character {
            '\r' if characters.peek() == Some(&'\n') => {
                characters.next();
                out.push(' ');
            }
            '\n' | '\u{b}' | '\u{c}' | '\r' | '\u{85}' | '\u{2028}' | '\u{2029}' => out.push(' '),
            other => out.push(other),
        }
    }
    out
}

// Exposure: which options a tool exposes, which the author keeps off every call, and which a call
// must supply.

/// Whether a node is the option's: a control option, which no accessor of `OptionNode` names.
fn is_control(option: &OptionNode) -> bool {
    match option {
        OptionNode::String(node) => node.control,
        OptionNode::Content(node) => node.control,
        OptionNode::Boolean(node) => node.control,
        OptionNode::Count(node) => node.control,
        _ => false,
    }
}

/// Whether the author excluded the option from every tool with `McpInputFacts::excluded()`.
pub(super) fn excluded(option: &OptionNode) -> Result<bool, Error> {
    Ok(read_extension(option, &MCP_INPUT)?.is_some_and(|facts| facts.exclude == Some(true)))
}

/// An option a tool exposes: neither hidden, a control option, nor excluded.
fn exposed(option: &OptionNode) -> Result<bool, Error> {
    Ok(!option.hidden() && !is_control(option) && !excluded(option)?)
}

/// Every option the Command's tool leaves out of a call: its excluded local options and every
/// excluded global option.
pub(super) fn excluded_names(
    graph: &CommandGraph,
    command: &CommandNode,
) -> Result<Vec<String>, Error> {
    let mut names = Vec::new();
    for option in command.options.iter().chain(graph.globals.iter()) {
        if excluded(option)? {
            names.push(option.name().to_owned());
        }
    }
    Ok(names)
}

/// Whether a call must supply the option: a string or content option that is required, a content
/// option with a positive minimum included, or that is required when the run is not interactive,
/// which a tool call never is.
pub(super) fn required_in_call(option: &OptionNode) -> bool {
    match option {
        OptionNode::String(node) => {
            node.required || node.required_when == Some(RequiredWhen::NonInteractive)
        }
        OptionNode::Content(node) => {
            node.required || node.required_when == Some(RequiredWhen::NonInteractive)
        }
        _ => false,
    }
}

// The tool listing.

/// Every Command under `command`, itself first, depth first in authoring order.
fn walk(command: &Arc<CommandNode>, into: &mut Vec<Arc<CommandNode>>) {
    into.push(Arc::clone(command));
    for child in &command.children {
        walk(child, into);
    }
}

/// A tool's name: the Command's path joined by `_`, or the application name at the root, with
/// each `-` written as `_`. A portable name holds nothing else the protocol's tool names exclude.
fn tool_name(graph: &CommandGraph, command: &CommandNode) -> String {
    let joined = if command.path.is_empty() {
        graph.name.clone()
    } else {
        command.path.join("_")
    };
    joined.replace('-', "_")
}

/// Every Command that carries an `MCP_COMMAND` value, in graph order, under its tool name.
pub(super) fn tool_entries(graph: &CommandGraph) -> Result<Vec<ToolEntry>, Error> {
    let mut commands = Vec::new();
    walk(&graph.root, &mut commands);
    let mut entries = Vec::new();
    for command in commands {
        if read_extension(&command, &MCP_COMMAND)?.is_some() {
            entries.push(ToolEntry {
                name: tool_name(graph, &command),
                command,
            });
        }
    }
    Ok(entries)
}

/// The inputs a Command's tool lists: its arguments in declaration order, then its local options
/// in authoring order, then every global option in graph order, minus hidden, control, and
/// excluded options.
pub(super) fn properties_of(
    graph: &CommandGraph,
    command: &CommandNode,
) -> Result<Vec<Property>, Error> {
    let mut properties: Vec<Property> = command
        .arguments
        .iter()
        .map(|node| Property::Argument(Arc::clone(node)))
        .collect();
    for (options, global) in [(&command.options, false), (&graph.globals, true)] {
        for node in options {
            if exposed(node)? {
                properties.push(Property::Option {
                    node: Arc::clone(node),
                    global,
                });
            }
        }
    }
    Ok(properties)
}

/// A description for an agent, opened by a deprecation's migration message where there is one,
/// then a line break and the rest. The migration message is one line, a line break the author
/// wrote read as a space, so the line break after it is the only one between the two.
fn described(description: Option<String>, deprecated: Option<&str>) -> Option<String> {
    let Some(deprecated) = deprecated else {
        return description;
    };
    let notice = format!("Deprecated: {}", single_line(deprecated));
    Some(match description {
        None => notice,
        Some(description) => format!("{notice}\n{description}"),
    })
}

/// The schema of one value the input takes: the published one without its top-level `$schema`
/// key, or one derived from its kind. The property sits inside the tool's input schema, whose
/// default dialect is the converter's target.
fn value_schema(property: &Property) -> Schema {
    let published = match property {
        Property::Argument(node) => node.schema.as_ref(),
        Property::Option { node, .. } => match node.as_ref() {
            OptionNode::String(node) => node.schema.as_ref(),
            OptionNode::Content(node) => node.schema.as_ref(),
            OptionNode::Boolean(node) => node.schema.as_ref(),
            OptionNode::Count(node) => node.schema.as_ref(),
            _ => None,
        },
    };
    if let Some(schema) = published {
        let mut schema = schema.clone();
        schema.shift_remove("$schema");
        return schema;
    }
    let derived = match property {
        Property::Option { node, .. } => match node.as_ref() {
            OptionNode::Boolean(_) => json!({ "type": "boolean" }),
            OptionNode::Count(_) => json!({ "type": "integer", "minimum": 0 }),
            _ => json!({ "type": "string" }),
        },
        Property::Argument(_) => json!({ "type": "string" }),
    };
    match derived {
        Value::Object(map) => map,
        _ => Schema::new(),
    }
}

/// Whether the input takes several values.
fn takes_several(property: &Property) -> bool {
    match property {
        Property::Argument(node) => node.variadic,
        Property::Option { node, .. } => match node.as_ref() {
            OptionNode::String(node) => node.multiple,
            OptionNode::Content(node) => node.multiple,
            _ => false,
        },
    }
}

/// The input's description for an agent: its extension value's as written, or else its core
/// description on one line, a line break the author wrote read as a space.
fn property_description(property: &Property) -> Result<Option<String>, Error> {
    match property {
        Property::Argument(node) => Ok(read_extension(node, &MCP_ARGUMENT)?
            .map(|facts| facts.description)
            .or_else(|| node.description.as_deref().map(single_line))),
        Property::Option { node, .. } => {
            let own = read_extension(node, &MCP_INPUT)?.and_then(|facts| facts.description);
            let core = || option_description(node).map(single_line);
            Ok(described(own.or_else(core), node.deprecated()))
        }
    }
}

/// An option's core description.
fn option_description(node: &OptionNode) -> Option<&str> {
    match node {
        OptionNode::String(node) => node.description.as_deref(),
        OptionNode::Content(node) => node.description.as_deref(),
        OptionNode::Boolean(node) => node.description.as_deref(),
        OptionNode::Count(node) => node.description.as_deref(),
        _ => None,
    }
}

/// The input's declared default, which is always plain JSON data in a Rust graph.
fn property_default(property: &Property) -> Option<Value> {
    let declared = match property {
        Property::Argument(node) => node.default.as_ref(),
        Property::Option { node, .. } => match node.as_ref() {
            OptionNode::String(node) => node.default.as_ref(),
            OptionNode::Content(node) => node.default.as_ref(),
            _ => None,
        },
    };
    declared.map(|default| default.value.clone())
}

/// The bounds of a content input: whether it is required, and its declared minimum and maximum.
fn content_bounds(property: &Property) -> Option<(bool, Option<usize>, Option<usize>)> {
    match property {
        Property::Argument(node) if node.kind.is_some() => {
            Some((node.required, node.min, node.max))
        }
        Property::Option { node, .. } => match node.as_ref() {
            OptionNode::Content(node) => Some((node.required, node.min, node.max)),
            _ => None,
        },
        Property::Argument(_) => None,
    }
}

/// The item counts a list property declares: a content list's own minimum and maximum, and at
/// least one item for any other list a call must supply, because core reads an empty one as
/// missing.
fn list_bounds(property: &Property, schema: &mut Schema) {
    if let Some((required, min, max)) = content_bounds(property) {
        let floor = usize::from(required);
        schema.insert("minItems".into(), json!(floor.max(min.unwrap_or(floor))));
        if let Some(max) = max {
            schema.insert("maxItems".into(), json!(max));
        }
        return;
    }
    if is_required(property) {
        schema.insert("minItems".into(), json!(1));
    }
}

/// One property of a tool's input schema: the value's schema, wrapped as an array for several
/// values, at least one when the tool requires the input, with the description and default the
/// plugin sets in place of any the converter wrote.
fn property_schema(property: &Property) -> Result<Schema, Error> {
    let mut value = value_schema(property);
    if let Property::Option { node, .. } = property
        && let Some(arity) = node.arity()
    {
        let mut tuple = Schema::new();
        tuple.insert("type".into(), json!("array"));
        tuple.insert("items".into(), Value::Object(value));
        tuple.insert("minItems".into(), json!(arity));
        tuple.insert("maxItems".into(), json!(arity));
        value = tuple;
    }
    let mut schema = if takes_several(property) {
        let mut list = Schema::new();
        list.insert("type".into(), json!("array"));
        list.insert("items".into(), Value::Object(value));
        list_bounds(property, &mut list);
        list
    } else {
        value
    };
    if let Some(description) = property_description(property)? {
        schema.insert("description".into(), Value::String(description));
    }
    if let Some(default) = property_default(property) {
        schema.insert("default".into(), default);
    }
    Ok(schema)
}

/// Whether the tool requires the input: a required argument or a required local option.
pub(super) fn is_required(property: &Property) -> bool {
    match property {
        Property::Argument(node) => {
            node.required || node.required_when == Some(RequiredWhen::NonInteractive)
        }
        Property::Option { node, global } => !global && required_in_call(node),
    }
}

/// The object a tool's arguments form, keyed by each listed input's declared name.
fn input_schema(properties: &[Property], command: &CommandNode) -> Result<Schema, Error> {
    let groups = group_schemas(command)?;
    let mut schema = Schema::new();
    schema.insert("type".into(), json!("object"));
    if !groups.is_empty() {
        schema.insert(
            "allOf".into(),
            Value::Array(groups.into_iter().map(Value::Object).collect()),
        );
    }
    let mut listed = Schema::new();
    for property in properties {
        listed.insert(
            property.name().to_owned(),
            Value::Object(property_schema(property)?),
        );
    }
    schema.insert("properties".into(), Value::Object(listed));
    let required: Vec<Value> = properties
        .iter()
        .filter(|property| is_required(property))
        .map(|property| Value::String(property.name().to_owned()))
        .collect();
    if !required.is_empty() {
        schema.insert("required".into(), Value::Array(required));
    }
    schema.insert("additionalProperties".into(), json!(false));
    Ok(schema)
}

/// The hints the author set, in the protocol's words. An unset hint is left out, and a tool with
/// none carries no annotations.
fn annotations_of(command: &CommandNode) -> Result<Option<ToolAnnotations>, Error> {
    let hints = read_extension(command, &MCP_COMMAND)?
        .and_then(|facts| facts.annotations)
        .unwrap_or_default();
    let projected = ToolAnnotations {
        read_only_hint: hints.read_only,
        destructive_hint: hints.destructive,
        idempotent_hint: hints.idempotent,
        open_world_hint: hints.open_world,
        ..ToolAnnotations::default()
    };
    Ok((projected != ToolAnnotations::default()).then_some(projected))
}

/// One tool as the listing shows it: its name, description, input schema, and hints.
pub(super) fn listed_tool(graph: &CommandGraph, entry: &ToolEntry) -> Result<Tool, Error> {
    let command = &entry.command;
    let own = read_extension(command.as_ref(), &MCP_COMMAND)?.and_then(|facts| facts.description);
    let core = || command.description.as_deref().map(single_line);
    let description = described(own.or_else(core), command.deprecated.as_deref());
    let properties = properties_of(graph, command)?;
    let mut tool = Tool::new(entry.name.clone(), input_schema(&properties, command)?);
    if let Some(description) = description {
        tool = tool.with_description(description);
    }
    if let Some(annotations) = annotations_of(command)? {
        tool = tool.with_annotations(annotations);
    }
    Ok(tool)
}

// Option groups.

/// Named values can lower to absence, so JSON key presence alone cannot describe every option: a
/// Boolean is present at the value that claims it, a count at one or more, and a list at one item
/// or more.
fn named_presence(option: &OptionNode) -> Schema {
    let value = match option {
        OptionNode::Boolean(node) if node.polarity != Polarity::Both => {
            Some(json!({ "const": node.polarity == Polarity::Positive }))
        }
        OptionNode::Count(_) => Some(json!({ "minimum": 1 })),
        OptionNode::String(node) if node.multiple => Some(json!({ "minItems": 1 })),
        OptionNode::Content(node) if node.multiple => Some(json!({ "minItems": 1 })),
        _ => None,
    };
    let mut schema = Schema::new();
    schema.insert("required".into(), json!([option.name()]));
    if let Some(value) = value {
        let mut properties = Schema::new();
        properties.insert(option.name().to_owned(), value);
        schema.insert("properties".into(), Value::Object(properties));
    }
    schema
}

/// MCP's extensions and the completion value hint carry no source bindings. The hint's identity is
/// named here ahead of the completion plugin defining it.
const UNBOUND_EXTENSIONS: [&str; 3] = [
    "@loomcli/plugins/mcp/input",
    "@loomcli/plugins/mcp/argument",
    "@loomcli/plugins/completion/input",
];

/// Another plugin's extension may hold a configuration binding, so an uncertain requirement stays
/// a rule the run checks alone. This plugin's own extensions bind nothing.
fn externally_unbound(option: &OptionNode) -> bool {
    let env = match option {
        OptionNode::String(node) => &node.env,
        OptionNode::Content(node) => &node.env,
        OptionNode::Boolean(node) => &node.env,
        OptionNode::Count(node) => &node.env,
        _ => return false,
    };
    env.is_empty()
        && option
            .extensions()
            .keys()
            .all(|identity| UNBOUND_EXTENSIONS.contains(&identity.as_str()))
}

/// The named values with which one member claims its exclusive group. A Boolean claims only off
/// its absent value, `true` unless it is negative, because one at its absent value neither wins
/// the group nor conflicts.
fn named_claim(option: &OptionNode) -> Schema {
    let OptionNode::Boolean(node) = option else {
        return named_presence(option);
    };
    let mut properties = Schema::new();
    properties.insert(
        option.name().to_owned(),
        json!({ "const": node.polarity != Polarity::Negative }),
    );
    let mut schema = Schema::new();
    schema.insert("properties".into(), Value::Object(properties));
    schema.insert("required".into(), json!([option.name()]));
    schema
}

/// The schema constraints one group of listed members states.
fn constraints(kind: OptionGroupKind, options: &[&OptionNode]) -> Vec<Schema> {
    let object = |value: Value| match value {
        Value::Object(map) => map,
        _ => Schema::new(),
    };
    if kind == OptionGroupKind::Exclusive {
        let claims: Vec<Schema> = options.iter().map(|option| named_claim(option)).collect();
        let mut pairs = Vec::new();
        for (index, first) in claims.iter().enumerate() {
            for second in &claims[index + 1..] {
                pairs.push(object(json!({ "not": { "allOf": [first, second] } })));
            }
        }
        return pairs;
    }
    if !options.iter().all(|option| externally_unbound(option)) {
        return Vec::new();
    }
    if kind == OptionGroupKind::Requires {
        return options
            .split_first()
            .map(|(option, needed)| requirement_constraint(option, needed))
            .into_iter()
            .collect();
    }
    let presence: Vec<Value> = options
        .iter()
        .map(|option| Value::Object(named_presence(option)))
        .collect();
    match kind {
        OptionGroupKind::OneRequired => vec![object(json!({ "anyOf": presence }))],
        OptionGroupKind::RequiredTogether => vec![object(json!({
            "anyOf": [{ "not": { "anyOf": presence } }, { "allOf": presence }]
        }))],
        _ => Vec::new(),
    }
}

/// Whether supplying a named property always supplies the option.
fn scalar_value(option: &OptionNode) -> bool {
    match option {
        OptionNode::String(node) => !node.multiple,
        OptionNode::Content(node) => !node.multiple,
        _ => false,
    }
}

/// Key presence suffices for scalar values and for needed Booleans of both polarities.
/// Otherwise use the same named-value predicates as the other groups.
fn requirement_constraint(option: &OptionNode, needed: &[&OptionNode]) -> Schema {
    if scalar_value(option)
        && needed.iter().all(|member| {
            scalar_value(member)
                || matches!(member, OptionNode::Boolean(node) if node.polarity == Polarity::Both)
        })
    {
        let names: Vec<&str> = needed.iter().map(|member| member.name()).collect();
        return Schema::from_iter([(
            "dependentRequired".to_owned(),
            json!({ (option.name()): names }),
        )]);
    }
    let presence: Vec<Schema> = needed.iter().map(|member| named_presence(member)).collect();
    Schema::from_iter([(
        "anyOf".to_owned(),
        json!([{ "not": named_claim(option) }, { "allOf": presence }]),
    )])
}

/// The members of a group that the Command declares, in the group's order.
pub(super) fn group_members<'a>(
    command: &'a CommandNode,
    group: &OptionGroup,
) -> Vec<&'a OptionNode> {
    group
        .members()
        .filter_map(|name| {
            command
                .options
                .iter()
                .find(|option| option.name() == name)
                .map(Arc::as_ref)
        })
        .collect()
}

/// The constraints a tool's schema states for the Command's option groups. An excluded member is
/// never supplied in a call, so a group constrains the members the tool lists. A group that also
/// holds a hidden or control member, which a call may still fill from the server's sources, stays
/// a rule the run checks alone. A requirement is projected only with all its members listed.
fn group_schemas(command: &CommandNode) -> Result<Vec<Schema>, Error> {
    let mut schemas = Vec::new();
    for group in &command.option_groups {
        let members = group_members(command, group);
        let mut listed = Vec::new();
        for member in &members {
            if !excluded(member)? {
                listed.push(*member);
            }
        }
        let partial = listed.len() != members.len();
        let mut all_exposed = true;
        for option in &listed {
            all_exposed &= exposed(option)?;
        }
        if listed.is_empty()
            || !all_exposed
            || (partial
                && matches!(
                    group.kind(),
                    OptionGroupKind::RequiredTogether | OptionGroupKind::Requires
                ))
        {
            continue;
        }
        schemas.extend(constraints(group.kind(), &listed));
    }
    Ok(schemas)
}

#[cfg(test)]
mod tests {
    use super::single_line;

    #[test]
    fn each_line_break_reads_as_one_space() {
        assert_eq!(
            single_line("Read one value\r\nat a path."),
            "Read one value at a path."
        );
        assert_eq!(single_line("A\nB\u{2028}C\rD"), "A B C D");
    }
}
