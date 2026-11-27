//! The build faults of the opted-in Commands, judged by the plugin's `on_graph_built` hook on every
//! build, a run that never serves a tool included.

use std::collections::HashMap;
use std::sync::Arc;

use loomcli_core::{
    CommandGraph, CommandNode, DeclarationError, DiagnosticParts, DiagnosticRule, Error,
    OptionGroupKind, OptionNode, diagnostic_rule,
};

use super::tools::{
    Property, excluded, group_members, properties_of, required_in_call, tool_entries,
};

/// Two opted-in Commands that give one MCP tool name, the root included.
const TOOL_NAME_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/mcp/tool-name-taken",
    "MCP tool name taken",
    "An MCP client calls a tool by its name: the Command path joined with underscores, or the application name for the root, with each hyphen written as an underscore. Two Commands that give one name leave the client no way to call either one.",
);

/// `MCP_COMMAND` on a Command that registers no action.
const TOOL_WITHOUT_ACTION: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/mcp/tool-without-action",
    "MCP tool without an action",
    "An MCP tool call runs the Command's action, so a Command with no action, such as a group, has nothing to run when a client calls it.",
);

/// An opted-in Command that always fails an invocation by name.
const TOOL_NEEDS_TERMINAL: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/mcp/tool-needs-terminal",
    "MCP tool needs a terminal",
    "An MCP tool call is an invocation by name, which has no terminal, so a Command that declares it needs a terminal fails every call a client makes.",
);

/// An argument and an option one MCP tool would list under one name.
const PROPERTY_NAME_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/mcp/property-name-taken",
    "MCP property name taken",
    "An MCP tool takes its arguments and options as one object keyed by declared name, so an argument and an option that share a name leave the client no way to supply each one.",
);

/// A required local option, or what a group needs, that the author excluded from the tool.
const REQUIRED_INPUT_EXCLUDED: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/mcp/required-input-excluded",
    "Required MCP input excluded",
    "An excluded option is off its Command's MCP tool, and a tool call reads no source for it, so a required option that is excluded, a one-required group whose every member is excluded, a required-together group that excludes some of its members, and a requirement that excludes an option it needs and not its option leave calls of the tool missing a value the Command needs.",
);

/// One fault under a rule, with its sentence and correction.
fn fault(rule: DiagnosticRule, sentence: String, correction: &str) -> DeclarationError {
    DeclarationError::new(rule, DiagnosticParts::new(sentence).correction(correction))
}

/// A Command as a sentence that opens with it names it: its quoted path, or the root Command.
fn opening(command: &CommandNode) -> String {
    if command.path.is_empty() {
        "The root Command".to_owned()
    } else {
        format!("Command \"{}\"", command.path.join(" "))
    }
}

/// The pair of Commands in a name collision, the earlier in graph order first. The root comes
/// first in graph order, so only the earlier can be the root, when a child is named like the
/// application.
fn pair(earlier: &CommandNode, later: &CommandNode) -> String {
    if earlier.path.is_empty() {
        return format!("The root Command and Command \"{}\"", later.path.join(" "));
    }
    format!(
        "Commands \"{}\" and \"{}\"",
        earlier.path.join(" "),
        later.path.join(" ")
    )
}

/// The first argument and listed option that share a name, if any.
fn shared_name(properties: &[Property]) -> Option<(&str, &Property)> {
    properties.iter().find_map(|argument| {
        let Property::Argument(node) = argument else {
            return None;
        };
        properties
            .iter()
            .find(|each| matches!(each, Property::Option { .. }) && each.name() == node.name)
            .map(|option| (node.name.as_str(), option))
    })
}

/// The fault, if any, of one opted-in Command's inputs.
fn property_fault(
    graph: &CommandGraph,
    command: &CommandNode,
) -> Result<Option<DeclarationError>, Error> {
    let properties = properties_of(graph, command)?;
    let Some((argument, option)) = shared_name(&properties) else {
        return Ok(None);
    };
    let subject = match option {
        Property::Option { global: true, .. } => "global option",
        _ => "option",
    };
    Ok(Some(fault(
        PROPERTY_NAME_TAKEN,
        format!(
            "{} declares argument \"{argument}\" and {subject} \"{}\", which one MCP tool lists under one name.",
            opening(command),
            option.name()
        ),
        "Rename one of them, or remove mcpCommand.",
    )))
}

/// The fault, if any, of a required local option that the author excluded from the tool.
fn required_fault(command: &CommandNode) -> Result<Option<DeclarationError>, Error> {
    for option in &command.options {
        if excluded(option)? && required_in_call(option) {
            return Ok(Some(fault(
                REQUIRED_INPUT_EXCLUDED,
                format!(
                    "{} requires option \"{}\" and excludes it from its MCP tool, which leaves every call without a value.",
                    opening(command),
                    option.name()
                ),
                "Make the option optional, or remove exclude from its mcpInput value.",
            )));
        }
    }
    Ok(None)
}

/// Quoted option names joined for a sentence.
fn names_of(names: &[&str]) -> String {
    let quoted: Vec<String> = names.iter().map(|name| format!("\"{name}\"")).collect();
    match quoted.as_slice() {
        [only] => only.clone(),
        [first, second] => format!("{first} and {second}"),
        [rest @ .., last] => format!("{}, and {last}", rest.join(", ")),
        [] => String::new(),
    }
}

/// Excluding the trigger makes a requirement inert. If the trigger remains, even a hidden
/// trigger can be supplied from server sources, so an excluded dependency is a build fault.
fn requirement_fault(
    command: &CommandNode,
    members: &[&OptionNode],
) -> Result<Option<DeclarationError>, Error> {
    let Some((option, needed)) = members.split_first() else {
        return Ok(None);
    };
    if excluded(option)? {
        return Ok(None);
    }
    for member in needed {
        if excluded(member)? {
            let names: Vec<&str> = needed.iter().map(|member| member.name()).collect();
            let noun = if names.len() == 1 {
                "option"
            } else {
                "options"
            };
            return Ok(Some(fault(
                REQUIRED_INPUT_EXCLUDED,
                format!(
                    r#"{} makes option "{}" require {noun} {} and excludes "{}" from its MCP tool, so a call that supplies "{}" always fails."#,
                    opening(command),
                    option.name(),
                    names_of(&names),
                    member.name(),
                    option.name(),
                ),
                &format!(
                    r#"Exclude "{}" from the tool as well, or remove exclude from the mcpInput value of "{}"."#,
                    option.name(),
                    member.name(),
                ),
            )));
        }
    }
    Ok(None)
}

/// The first group whose excluded members make a valid tool call impossible when its rule applies.
fn group_fault(command: &CommandNode) -> Result<Option<DeclarationError>, Error> {
    for group in &command.option_groups {
        let members = group_members(command, group);
        let kind = group.kind();
        if kind == OptionGroupKind::Requires {
            if let Some(error) = requirement_fault(command, &members)? {
                return Ok(Some(error));
            }
            continue;
        }
        let mut left = Vec::new();
        for member in &members {
            if excluded(member)? {
                left.push(member);
            }
        }
        let names: Vec<&str> = members.iter().map(|member| member.name()).collect();
        let names = names_of(&names);
        if kind == OptionGroupKind::OneRequired && left.len() == members.len() {
            return Ok(Some(fault(
                REQUIRED_INPUT_EXCLUDED,
                format!(
                    "{} requires one of options {names} and excludes every one from its MCP tool, which leaves every call without a value.",
                    opening(command)
                ),
                "Remove exclude from the mcpInput value of one of them.",
            )));
        }
        let some_left = left.first().filter(|_| left.len() < members.len());
        if let (OptionGroupKind::RequiredTogether, Some(first)) = (kind, some_left) {
            return Ok(Some(fault(
                REQUIRED_INPUT_EXCLUDED,
                format!(
                    "{} requires options {names} together and excludes \"{}\" from its MCP tool, so a call that supplies the rest always fails.",
                    opening(command),
                    first.name()
                ),
                "Exclude every option of the group from the tool, or none.",
            )));
        }
    }
    Ok(None)
}

/// The fault, if any, of one opted-in Command alone: a tool needs an action to run.
fn action_fault(command: &CommandNode) -> Option<DeclarationError> {
    (!command.has_action).then(|| {
        fault(
            TOOL_WITHOUT_ACTION,
            format!(
                "{} carries mcpCommand and registers no action.",
                opening(command)
            ),
            "Remove mcpCommand, or opt in the Commands under it.",
        )
    })
}

/// The fault, if any, of a tool name an earlier opted-in Command already serves.
fn name_fault(
    earlier: Option<&Arc<CommandNode>>,
    command: &CommandNode,
    name: &str,
) -> Option<DeclarationError> {
    earlier.map(|earlier| {
        fault(
            TOOL_NAME_TAKEN,
            format!(
                "{} both serve the MCP tool \"{name}\".",
                pair(earlier, command)
            ),
            "Rename one Command, or remove mcpCommand from one of them.",
        )
    })
}

/// Judges the opted-in Commands of every build, a run that never serves a tool included: each has
/// an action, no two give one tool name, no tool lists an argument and an option under one name,
/// and no tool excludes a required local option or what a group needs from every call.
///
/// # Errors
///
/// The first fault, in graph order, as a `DeclarationError` under its rule.
pub(super) fn judge_tools(graph: &CommandGraph) -> Result<(), Error> {
    let mut named: HashMap<String, Arc<CommandNode>> = HashMap::new();
    for entry in tool_entries(graph)? {
        if let Some(found) =
            entry_fault(graph, named.get(&entry.name), &entry.command, &entry.name)?
        {
            return Err(found.into());
        }
        named.insert(entry.name, entry.command);
    }
    Ok(())
}

/// The first fault of one opted-in Command, in the order the rules are judged.
fn entry_fault(
    graph: &CommandGraph,
    earlier: Option<&Arc<CommandNode>>,
    command: &CommandNode,
    name: &str,
) -> Result<Option<DeclarationError>, Error> {
    if let Some(found) = action_fault(command) {
        return Ok(Some(found));
    }
    if command.needs_terminal {
        return Ok(Some(fault(
            TOOL_NEEDS_TERMINAL,
            super::messages::tool_needs_terminal(&command.path),
            "Remove mcpCommand, or remove needs_terminal() from the Command.",
        )));
    }
    if let Some(found) = name_fault(earlier, command, name) {
        return Ok(Some(found));
    }
    if let Some(found) = property_fault(graph, command)? {
        return Ok(Some(found));
    }
    if let Some(found) = required_fault(command)? {
        return Ok(Some(found));
    }
    group_fault(command)
}
