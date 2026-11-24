//! The help page of one routed Command, derived from the graph, the routed node, and the variant,
//! and nothing else.
//!
//! The page is a sequence of blocks separated by one blank line: the masthead, Details (extended
//! alone), USAGE, the Command sections, ARGUMENTS, INPUT, the option sections, the option-group
//! sentences, EXAMPLES (extended alone), the hints, and the epilogs. A block with nothing to show
//! is omitted. Every graph and extension string is escaped before it is styled or measured.

use std::sync::Arc;

use loomcli_core::style::nowrap;
use loomcli_core::{
    ArgumentNode, CommandGraph, CommandNode, Error, OptionGroupKind, OptionNode, ViewContext,
    read_extension, reported_spelling,
};

use super::accepted::accepted;
use super::cells::{
    OptionHelp, ROW_INDENT, Row, UsageStyle, UsageWriter, argument_facts, argument_form, column,
    deprecated_facts, named_in_usage, option_cell, option_facts, option_form, right_cell,
    single_line,
};
use super::details::render_details;
use super::extension::{CommandExample, HELP_ARGUMENT, HELP_COMMAND, HELP_INPUT, HelpCommandFacts};
use super::layout::{Hang, continuation, hang_lines, on_terminal, prose, signed, spaces};
use super::sections::{SectionMember, section_blocks};
use super::views::{HelpPage, HelpVariant};
use crate::config::extension::CONFIG_INPUT;

/// The help facts one Command carries.
pub(crate) fn command_help(command: &CommandNode) -> Result<HelpCommandFacts, Error> {
    Ok(read_extension(command, &HELP_COMMAND)?.unwrap_or_default())
}

/// The facts help reads from one option's extensions.
fn option_help(option: &OptionNode) -> Result<(OptionHelp, Option<Vec<String>>), Error> {
    let help = read_extension(option, &HELP_INPUT)?.unwrap_or_default();
    let config = read_extension(option, &CONFIG_INPUT)?;
    Ok((
        OptionHelp {
            placeholder: help.placeholder,
            accepts: help.accepts,
            hide_bindings: help.hide_bindings == Some(true),
            config_path: config.map(|facts| facts.path),
        },
        help.section,
    ))
}

/// An option with the facts help read for it.
pub(crate) struct ReadOption {
    pub(crate) node: Arc<OptionNode>,
    pub(crate) help: OptionHelp,
    pub(crate) section: Option<Vec<String>>,
}

/// The visible options with the facts help reads for each, in declaration order.
pub(crate) fn read_options(options: &[Arc<OptionNode>]) -> Result<Vec<ReadOption>, Error> {
    options
        .iter()
        .filter(|option| !option.hidden())
        .map(|option| {
            let (help, section) = option_help(option)?;
            Ok(ReadOption {
                node: Arc::clone(option),
                help,
                section,
            })
        })
        .collect()
}

/// The routed path: the application name, then the route to the node, space-separated.
pub(crate) fn path_of(graph: &CommandGraph, command: &CommandNode) -> String {
    std::iter::once(graph.name.as_str())
        .chain(command.path.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join(" ")
}

/// The label of the line under a deprecated Command's masthead, ahead of its message.
const DEPRECATION_LABEL: &str = "Deprecated: ";

/// The indent of the deprecation line.
const DEPRECATION_INDENT: &str = "  ";

/// Where a masthead description continues when its hang after the path cannot fit.
const MASTHEAD_BASE: i64 = 2;

/// The deprecation line under a masthead. On a terminal its message wraps and continues under its
/// first character, after the label, or at the line's indent when that hang cannot fit. Each line
/// is one warning value.
fn deprecation(message: &str, context: &ViewContext) -> Vec<String> {
    let style = &context.style;
    let label = style.escape(DEPRECATION_LABEL);
    let text = style.escape(message);
    let warning = style.warning();
    let Some(columns) = super::layout::columns(context) else {
        return vec![format!(
            "{DEPRECATION_INDENT}{}",
            warning.apply(&format!("{label}{text}"))
        )];
    };
    let base = signed(context.width(DEPRECATION_INDENT));
    let hung = hang_lines(
        &text,
        &Hang {
            base,
            columns,
            lead: base + signed(context.width(&label)),
        },
        context,
    );
    let indent = spaces(hung.indent);
    std::iter::once(format!(
        "{DEPRECATION_INDENT}{}",
        warning.apply(&format!("{label}{}", hung.first))
    ))
    .chain(
        hung.rest
            .iter()
            .map(|line| continuation(&warning.apply(line), &indent, context)),
    )
    .collect()
}

/// `<path> · <description>`, or `<path>` alone, then a deprecated Command's migration message.
fn masthead(path: &str, command: &CommandNode, context: &ViewContext) -> Vec<String> {
    let style = &context.style;
    let name = style.highlight().bold().apply(&style.escape(path));
    let mut lines = match command.description.as_deref().map(single_line) {
        None => vec![name],
        Some(description) => prose(
            &style.primary().apply(&style.escape(&description)),
            Some(MASTHEAD_BASE),
            &format!("{name} {} ", style.dim().apply("·")),
            context,
        ),
    };
    if let Some(deprecated) = command.deprecated.as_deref().map(single_line) {
        lines.extend(deprecation(&deprecated, context));
    }
    lines
}

/// The action form and the children form of the USAGE block, as their styled strings.
pub(crate) fn usage_forms(
    command: &CommandNode,
    graph: &CommandGraph,
    options: &[ReadOption],
    any_visible_child: bool,
    writer: &dyn UsageStyle,
) -> Vec<String> {
    let path = writer.path(&path_of(graph, command));
    let mut forms = Vec::new();
    if command.has_action {
        let mut parts: Vec<String> = command
            .arguments
            .iter()
            .map(|argument| argument_form(argument, writer))
            .collect();
        parts.extend(
            options
                .iter()
                .filter(|option| named_in_usage(&option.node))
                .map(|option| option_form(&option.node, &option.help, writer)),
        );
        // `[options]` is always present, because the help option is one.
        parts.push(writer.word("[options]"));
        forms.push(format!("{path} {}", parts.join(" ")));
    }
    let group = !command.has_action && !command.children.is_empty();
    if any_visible_child || group {
        forms.push(format!(
            "{path} {} {}",
            writer.word("<command>"),
            writer.word("[options]")
        ));
    }
    forms
}

/// The USAGE block: one line per form, the action form of a node whose stdin is required opening
/// with `<producer> | `.
fn usage(
    command: &CommandNode,
    graph: &CommandGraph,
    options: &[ReadOption],
    any_visible_child: bool,
    context: &ViewContext,
) -> Vec<String> {
    let style = &context.style;
    let writer = UsageWriter::new(context);
    let forms = usage_forms(command, graph, options, any_visible_child, &writer);
    if forms.is_empty() {
        return Vec::new();
    }
    let producer = command.stdin.as_ref().is_some_and(|stdin| stdin.required) && command.has_action;
    std::iter::once(style.dim().apply("USAGE"))
        .chain(forms.iter().enumerate().map(|(index, form)| {
            if producer && index == 0 {
                format!("  {} | {form}", style.dim().italic().apply("<producer>"))
            } else {
                format!("  {form}")
            }
        }))
        .collect()
}

/// The form a child row names after the child's name: `<command>` for a group, `[command]` for a
/// Command with an action and children, and none for a leaf.
pub(crate) fn child_suffix(child: &CommandNode) -> Option<&'static str> {
    if child.children.is_empty() {
        None
    } else if child.has_action {
        Some("[command]")
    } else {
        Some("<command>")
    }
}

/// One child row: its name, the form it answers to, and its description and deprecation.
fn child_row(child: &CommandNode, context: &ViewContext) -> Row {
    let style = &context.style;
    let name = style
        .highlight()
        .apply(&style.escape(child.name.as_deref().unwrap_or("")));
    let left = match child_suffix(child) {
        None => name,
        Some(suffix) => format!("{name} {}", style.dim().italic().apply(suffix)),
    };
    Row {
        left,
        right: right_cell(
            child.description.as_deref(),
            None,
            &deprecated_facts(child.deprecated.as_deref()),
            context,
        ),
    }
}

/// The Command section blocks: the visible children under COMMANDS unless an authored section
/// holds one, in the order the routed Command's `command_sections` names.
fn commands(
    order: Option<&[Vec<String>]>,
    children: &[Arc<CommandNode>],
    context: &ViewContext,
) -> Result<Vec<Vec<String>>, Error> {
    let members = children
        .iter()
        .map(|child| {
            Ok(SectionMember {
                fallback: "COMMANDS",
                path: command_help(child)?.section,
                row: child_row(child, context),
            })
        })
        .collect::<Result<Vec<_>, Error>>()?;
    Ok(section_blocks(order, members, context))
}

/// The ARGUMENTS block: one row per argument in declaration order.
fn arguments(command: &CommandNode, context: &ViewContext) -> Result<Vec<String>, Error> {
    let rows = command
        .arguments
        .iter()
        .map(|argument| argument_row(argument, context))
        .collect::<Result<Vec<_>, Error>>()?;
    if rows.is_empty() {
        return Ok(Vec::new());
    }
    let mut lines = vec![context.style.dim().apply("ARGUMENTS")];
    lines.extend(column(&rows, context, ROW_INDENT));
    Ok(lines)
}

fn argument_row(argument: &ArgumentNode, context: &ViewContext) -> Result<Row, Error> {
    let style = &context.style;
    let authored = read_extension(argument, &HELP_ARGUMENT)?.and_then(|facts| facts.accepts);
    let accepts = accepted(authored.as_deref(), &argument.schema);
    Ok(Row {
        left: style.dim().italic().apply(&style.escape(&argument.name)),
        right: right_cell(
            argument.description.as_deref(),
            accepts.as_deref(),
            &argument_facts(argument),
            context,
        ),
    })
}

/// The sentence an option row prints for the values it accepts. A Boolean or counted option takes
/// no value and prints none.
pub(crate) fn option_accepts(option: &ReadOption) -> Option<String> {
    match option.node.as_ref() {
        OptionNode::String(node) => accepted(option.help.accepts.as_deref(), &node.schema),
        OptionNode::Content(node) => accepted(option.help.accepts.as_deref(), &node.schema),
        _ => None,
    }
}

/// The description an option row prints.
pub(crate) fn option_description(option: &OptionNode) -> Option<&str> {
    match option {
        OptionNode::String(node) => node.description.as_deref(),
        OptionNode::Content(node) => node.description.as_deref(),
        OptionNode::Boolean(node) => node.description.as_deref(),
        OptionNode::Count(node) => node.description.as_deref(),
        _ => None,
    }
}

/// One option row: its spellings and placeholder, then its description, accepted values, and
/// facts. A Boolean or counted option takes no value and prints no accepted values.
fn option_row(option: &ReadOption, context: &ViewContext) -> Row {
    Row {
        left: option_cell(&option.node, &option.help, context),
        right: right_cell(
            option_description(&option.node),
            option_accepts(option).as_deref(),
            &option_facts(&option.node, &option.help),
            context,
        ),
    }
}

/// The option section blocks: the visible local options under OPTIONS, then the visible globals
/// under GLOBAL OPTIONS, or under OPTIONS on the root of an Application with no children, unless
/// an authored section holds one.
fn options(
    order: Option<&[Vec<String>]>,
    locals: &[ReadOption],
    globals: &[ReadOption],
    folds: bool,
    context: &ViewContext,
) -> Vec<Vec<String>> {
    let global_heading = if folds { "OPTIONS" } else { "GLOBAL OPTIONS" };
    let members = locals
        .iter()
        .map(|option| ("OPTIONS", option))
        .chain(globals.iter().map(|option| (global_heading, option)))
        .map(|(fallback, option)| SectionMember {
            fallback,
            path: option.section.clone(),
            row: option_row(option, context),
        })
        .collect();
    section_blocks(order, members, context)
}

/// One example: the invocation, which stays whole, then its note on the next line indented two
/// more spaces, which wraps on a terminal.
fn example_lines(name: &str, example: &CommandExample, context: &ViewContext) -> Vec<String> {
    let style = &context.style;
    let mut lines = vec![format!(
        "  {} {} {}",
        style.dim().apply("$"),
        style.highlight().apply(&style.escape(name)),
        style.primary().apply(&style.escape(&example.command))
    )];
    if let Some(note) = &example.note {
        lines.extend(prose(
            &style.dim().apply(&style.escape(note)),
            None,
            "    ",
            context,
        ));
    }
    lines
}

/// The EXAMPLES block.
fn examples(name: &str, help: &HelpCommandFacts, context: &ViewContext) -> Vec<String> {
    let lines: Vec<String> = help
        .examples
        .iter()
        .flatten()
        .flat_map(|example| example_lines(name, example, context))
        .collect();
    if lines.is_empty() {
        return lines;
    }
    std::iter::once(context.style.dim().apply("EXAMPLES"))
        .chain(lines)
        .collect()
}

/// One hint: `Run`, the command it names, which stays whole on a terminal, and what it shows.
fn hint(command: &str, rest: &str, context: &ViewContext) -> Vec<String> {
    let style = &context.style;
    let named = if on_terminal(context) {
        nowrap(command)
    } else {
        command.to_owned()
    };
    prose(
        &format!(
            "{} {named} {}",
            style.dim().apply("Run"),
            style.dim().apply(rest)
        ),
        None,
        "",
        context,
    )
}

/// The closing hints: the child hint when the page printed child rows, spelled as the variant's own
/// help option, and on the compact page the pointer to the extended page when it omitted a block.
fn hints(
    path: &str,
    any_visible_child: bool,
    omitted: bool,
    variant: HelpVariant,
    context: &ViewContext,
) -> Vec<String> {
    let style = &context.style;
    let name = style.highlight().apply(&style.escape(path));
    let mut lines = Vec::new();
    if any_visible_child {
        let spelling = match variant {
            HelpVariant::Compact => "-h",
            HelpVariant::Extended => "--help",
        };
        lines.extend(hint(
            &format!(
                "{name} {} {}",
                style.dim().italic().apply("<command>"),
                style.highlight().apply(spelling)
            ),
            "for command details.",
            context,
        ));
    }
    if variant == HelpVariant::Compact && omitted {
        lines.extend(hint(
            &format!("{name} {}", style.highlight().apply("--help")),
            "for details and examples.",
            context,
        ));
    }
    lines
}

/// The INPUT block of a node that declares the standalone stdin.
fn stdin_input(command: &CommandNode, path: &str, context: &ViewContext) -> Vec<String> {
    let style = &context.style;
    let Some(input) = &command.stdin else {
        return Vec::new();
    };
    let mut lines = vec![style.dim().apply("INPUT")];
    if let Some(summary) = input.description.as_deref().map(single_line) {
        lines.extend(prose(
            &style.primary().apply(&style.escape(&summary)),
            None,
            "  ",
            context,
        ));
    }
    let presence = if input.required {
        "Required."
    } else {
        "Optional."
    };
    lines.extend(prose(
        &style.primary().apply(&format!(
            "{presence} Reads piped or redirected stdin. Terminal input is not accepted."
        )),
        None,
        "  ",
        context,
    ));
    lines.push(format!(
        "  {}",
        style
            .primary()
            .apply(&style.escape(&format!("Example: <producer> | {path}")))
    ));
    lines
}

/// One sentence per option group whose every member is visible, each prose at a two-space indent.
fn group_sentences(command: &CommandNode, context: &ViewContext) -> Vec<String> {
    let style = &context.style;
    command
        .option_groups
        .iter()
        .filter(|group| {
            group.options.iter().all(|name| {
                command
                    .options
                    .iter()
                    .any(|option| option.name() == name && !option.hidden())
            })
        })
        .flat_map(|group| {
            let nodes: Vec<&Arc<OptionNode>> = command
                .options
                .iter()
                .filter(|option| group.options.iter().any(|name| name == option.name()))
                .collect();
            let names: Vec<String> = group
                .options
                .iter()
                .map(|name| {
                    nodes
                        .iter()
                        .find(|node| node.name() == name)
                        .map_or_else(|| name.clone(), |node| reported_spelling(node))
                })
                .collect();
            let members = match names.as_slice() {
                [first, second] => format!("{first} and {second}"),
                [rest @ .., last] => format!("{}, and {last}", rest.join(", ")),
                [] => String::new(),
            };
            let rule = match group.kind {
                OptionGroupKind::Exclusive => format!("Use at most one of {members}"),
                OptionGroupKind::OneRequired => format!("Supply at least one of {members}"),
                OptionGroupKind::RequiredTogether => format!("Use {members} together"),
            };
            let caveat = if nodes
                .iter()
                .any(|node| matches!(node.as_ref(), OptionNode::Content(content) if content.stdin))
            {
                " (piped stdin does not count)"
            } else {
                ""
            };
            let sentence = style
                .primary()
                .apply(&style.escape(&format!("{rule}{caveat}.")));
            prose(&sentence, None, "  ", context)
        })
        .collect()
}

/// The ancestors of `command`, its parent first and the root last, reached through its path.
fn ancestors_of(graph: &CommandGraph, command: &CommandNode) -> Vec<Arc<CommandNode>> {
    let mut ancestors = Vec::new();
    let mut reached = Arc::clone(&graph.root);
    for name in &command.path {
        ancestors.insert(0, Arc::clone(&reached));
        let Some(child) = reached
            .children
            .iter()
            .find(|child| child.name.as_deref() == Some(name.as_str()))
            .cloned()
        else {
            break;
        };
        reached = child;
    }
    ancestors
}

/// The epilogs a page of `command` ends with: its own first, then each ancestor's, the root's last.
pub(crate) fn epilogs_of(
    graph: &CommandGraph,
    command: &CommandNode,
) -> Result<Vec<String>, Error> {
    let mut epilogs = Vec::new();
    if let Some(epilog) = command_help(command)?.epilog {
        epilogs.push(epilog);
    }
    for ancestor in ancestors_of(graph, command) {
        if let Some(epilog) = command_help(&ancestor)?.epilog {
            epilogs.push(epilog);
        }
    }
    Ok(epilogs)
}

/// The help page of one routed Command, with no line terminator at either end. A stored help value
/// the descriptors cannot read is the read's own declaration fault.
pub(super) fn render_page(page: &HelpPage, context: &ViewContext) -> Result<String, Error> {
    let HelpPage {
        command,
        graph,
        variant,
    } = page;
    let path = path_of(graph, command);
    let help = command_help(command)?;
    let children: Vec<Arc<CommandNode>> = command
        .children
        .iter()
        .filter(|child| !child.hidden)
        .cloned()
        .collect();
    let any_visible_child = !children.is_empty();
    let locals = read_options(&command.options)?;
    let globals = read_options(&graph.globals)?;
    let detail_lines = help
        .details
        .as_deref()
        .map(|source| render_details(source, context))
        .unwrap_or_default();
    let listed = examples(&graph.name, &help, context);
    let extended = *variant == HelpVariant::Extended;
    let omitted = !extended && !(detail_lines.is_empty() && listed.is_empty());
    let folds = graph.root.children.is_empty();

    let mut blocks: Vec<Vec<String>> = vec![masthead(&path, command, context)];
    if extended {
        blocks.push(detail_lines);
    }
    blocks.push(usage(command, graph, &locals, any_visible_child, context));
    blocks.extend(commands(
        help.command_sections.as_deref(),
        &children,
        context,
    )?);
    blocks.push(arguments(command, context)?);
    blocks.push(stdin_input(command, &path, context));
    blocks.extend(options(
        help.option_sections.as_deref(),
        &locals,
        &globals,
        folds,
        context,
    ));
    blocks.push(group_sentences(command, context));
    if extended {
        blocks.push(listed);
    }
    blocks.push(hints(&path, any_visible_child, omitted, *variant, context));
    for epilog in epilogs_of(graph, command)? {
        blocks.push(render_details(&epilog, context));
    }
    let text = blocks
        .into_iter()
        .filter(|block| !block.is_empty())
        .map(|block| block.join("\n"))
        .collect::<Vec<_>>()
        .join("\n\n");
    // On a terminal the page holds no tab, so a literal's tab expands from its line's start.
    Ok(if on_terminal(context) {
        context.expand_tabs(&text)
    } else {
        text
    })
}
