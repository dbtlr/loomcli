//! One man page: roff for the man macro package, derived from the graph and the help and
//! configuration values each Command carries, and from no host fact, so a graph gives the same
//! bytes on every host.

use std::sync::Arc;

use loomcli_core::{ArgumentNode, CommandGraph, CommandNode, Error, OptionNode, read_extension};

use super::markdown::{details_lines, notes_lines};
use super::pages::{findable, page_file, page_name};
use super::roff::{Fill, Font, escape, escape_text, escape_unbroken, in_font, request, text_line};
use crate::help::accepted::accepted;
use crate::help::cells::{
    Fact, OptionCellParts, UsageStyle, argument_facts, delimiter_literal, deprecated_facts,
    option_cell_parts, single_line, split_noun, unbound_option_facts,
};
use crate::help::extension::{CommandExample, HELP_ARGUMENT};
use crate::help::messages::{CHILD_NAME_ESCAPE, TERMINAL_NEED_LABEL, TERMINAL_NEED_TEXT};
use crate::help::page::{
    ReadOption, child_suffix, command_help, epilogs_of, notes_escape, option_accepts,
    option_description, path_of, read_options, usage_forms,
};
use crate::help::sections::{OrderedSection, SectionMember, ordered_sections};

/// The page section every page is in.
const SECTION: &str = "1";

/// The indentation of an example's note under its command.
const NOTE_INDENT: usize = 4;

/// One page of the set: its file name and its text.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ManPage {
    /// The page's file name, such as `jsonkit-get.1`.
    pub file: String,
    /// The page's roff text.
    pub text: String,
}

/// Help's right cell for a row as plain text, escaped as one filled line: the description on one
/// line, the accepted-values sentence, then the facts in one parenthesis, with one space between
/// the text parts and two before the parenthesis.
fn entry_text(description: Option<&str>, accepts: Option<&str>, facts: &[Fact]) -> String {
    let written: Vec<String> = [description.map(single_line), accepts.map(str::to_owned)]
        .into_iter()
        .flatten()
        .collect();
    let text = written.join(" ");
    let parenthesis = if facts.is_empty() {
        String::new()
    } else {
        let listed: Vec<&str> = facts.iter().map(Fact::text).collect();
        format!("({})", listed.join(", "))
    };
    // As help's right cell does, a description of "" is still a written part and keeps the gutter.
    let cell = match (written.is_empty(), parenthesis.is_empty()) {
        (_, true) => text,
        (true, false) => parenthesis,
        (false, false) => format!("{text}  {parenthesis}"),
    };
    escape(&cell)
}

/// One entry: `.TP`, its tag, and its text, a filled paragraph. An extra line follows a `.br`, and
/// an entry with no text writes its first extra line right after the tag.
fn entry(tag: &str, text: &str, extras: &[String]) -> Vec<String> {
    let mut lines = vec![".TP".to_owned(), text_line(tag)];
    if !text.is_empty() {
        lines.push(text_line(text));
    }
    for (index, extra) in extras.iter().enumerate() {
        if index > 0 || !text.is_empty() {
            lines.push(".br".to_owned());
        }
        lines.push(text_line(extra));
    }
    lines
}

/// A section's heading and its lines, or nothing when it has nothing to show.
fn headed(heading: &str, lines: Vec<String>) -> Vec<String> {
    if lines.is_empty() {
        return lines;
    }
    let mut section = vec![request("SH", &[heading])];
    section.extend(lines);
    section
}

/// Help's ordered sections as `.SH` and `.SS` sections, each row written as entries.
fn section_lines<Shown>(
    sections: &[OrderedSection<Shown>],
    write: impl Fn(&Shown) -> Vec<String>,
) -> Vec<String> {
    let mut lines = Vec::new();
    for outer in sections {
        lines.push(request("SH", &[&outer.heading]));
        lines.extend(outer.rows.iter().flat_map(&write));
        for (heading, rows) in &outer.subsections {
            lines.push(request("SS", &[heading]));
            lines.extend(rows.iter().flat_map(&write));
        }
    }
    lines
}

/// The rows of ordered sections in the order the page lists them.
fn listed<Shown>(sections: &[OrderedSection<Shown>]) -> Vec<&Shown> {
    sections
        .iter()
        .flat_map(|outer| {
            outer
                .rows
                .iter()
                .chain(outer.subsections.iter().flat_map(|(_, rows)| rows))
        })
        .collect()
}

/// What every section of one page reads.
struct Subject<'a> {
    graph: &'a CommandGraph,
    command: &'a CommandNode,
    parent: Option<&'a CommandNode>,
    children: Vec<Arc<CommandNode>>,
    locals: &'a [ReadOption],
    command_sections: Vec<OrderedSection<&'a Arc<CommandNode>>>,
    option_sections: Vec<OrderedSection<&'a ReadOption>>,
    examples: Vec<CommandExample>,
    details: Option<String>,
}

/// The page name with its ASCII letters in uppercase, as `.TH` names it.
fn title_name(name: &str) -> String {
    name.to_ascii_uppercase()
}

fn title(subject: &Subject<'_>) -> Vec<String> {
    let name = page_name(subject.graph, subject.command);
    let graph = subject.graph;
    vec![request(
        "TH",
        &[
            &title_name(&name),
            SECTION,
            "",
            &format!("{} {}", graph.name, graph.version),
            "",
        ],
    )]
}

fn name_section(subject: &Subject<'_>) -> Vec<String> {
    let name = escape(&page_name(subject.graph, subject.command));
    let line = match &subject.command.description {
        None => name,
        Some(description) => format!("{name} \\- {}", escape(&single_line(description))),
    };
    headed("NAME", vec![text_line(&line)])
}

/// How a usage form writes its words in no-fill text: the path in bold, every other word plain.
struct NoFillUsage;

impl UsageStyle for NoFillUsage {
    fn path(&self, text: &str) -> String {
        in_font(text, Font::Bold, Fill::NoFill)
    }

    fn spelling(&self, text: &str) -> String {
        escape_text(text, Fill::NoFill)
    }

    fn word(&self, text: &str) -> String {
        escape_text(text, Fill::NoFill)
    }
}

/// Each usage form help prints, in no-fill text, with the path in bold.
fn synopsis(subject: &Subject<'_>) -> Vec<String> {
    let command = subject.command;
    let forms = usage_forms(
        command,
        subject.graph,
        subject.locals,
        !subject.children.is_empty(),
        &NoFillUsage,
    );
    if forms.is_empty() {
        return Vec::new();
    }
    let producer = command.stdin.as_ref().is_some_and(|stdin| stdin.required) && command.has_action;
    let mut lines = vec![".nf".to_owned()];
    for (index, form) in forms.iter().enumerate() {
        lines.push(if producer && index == 0 {
            text_line(&format!(
                "{}{form}",
                escape_text("<producer> | ", Fill::NoFill)
            ))
        } else {
            text_line(form)
        });
    }
    lines.push(".fi".to_owned());
    headed("SYNOPSIS", lines)
}

/// The masthead facts as paragraphs, then the details.
fn description(subject: &Subject<'_>) -> Vec<String> {
    let mut lines = Vec::new();
    if subject.command.needs_terminal {
        lines.push(text_line(&escape(&format!(
            "{TERMINAL_NEED_LABEL}{TERMINAL_NEED_TEXT}"
        ))));
    }
    if let Some(message) = &subject.command.deprecated {
        if !lines.is_empty() {
            lines.push(".PP".to_owned());
        }
        lines.push(text_line(&escape(&format!(
            "Deprecated: {}",
            single_line(message)
        ))));
    }
    if let Some(source) = &subject.details {
        let preceded = !lines.is_empty();
        lines.extend(details_lines(source, preceded));
    }
    headed("DESCRIPTION", lines)
}

/// One child's entry: its name in bold and help's suffix, and help's right cell for the row.
fn child_entry(child: &&Arc<CommandNode>) -> Vec<String> {
    let name = in_font(child.name.as_deref().unwrap_or(""), Font::Bold, Fill::Fill);
    let tag = match child_suffix(child) {
        None => name,
        Some(suffix) => format!("{name} {}", escape(suffix)),
    };
    entry(
        &tag,
        &entry_text(
            child.description.as_deref(),
            None,
            &deprecated_facts(child.deprecated.as_deref()),
        ),
        &[],
    )
}

fn argument_entry(argument: &Arc<ArgumentNode>) -> Result<Vec<String>, Error> {
    let authored =
        read_extension(argument.as_ref(), &HELP_ARGUMENT)?.and_then(|facts| facts.accepts);
    let accepts = accepted(authored.as_deref(), &argument.schema);
    Ok(entry(
        &in_font(&argument.name, Font::Italic, Fill::Fill),
        &entry_text(
            argument.description.as_deref(),
            accepts.as_deref(),
            &argument_facts(argument),
        ),
        &[],
    ))
}

fn arguments_section(subject: &Subject<'_>) -> Result<Vec<String>, Error> {
    let mut lines = Vec::new();
    for argument in &subject.command.arguments {
        lines.extend(argument_entry(argument)?);
    }
    if let Some(mode) = &subject.command.passthrough {
        let args = in_font("args", Font::Italic, Fill::Fill);
        lines.extend(entry(
            &format!(r"\-\- {args}..."),
            &entry_text(mode.description.as_deref(), None, &[]),
            &[],
        ));
    } else if notes_escape(subject.command, !subject.children.is_empty()) {
        lines.extend(entry(
            r"\-\-",
            &entry_text(Some(CHILD_NAME_ESCAPE), None, &[]),
            &[],
        ));
    }
    Ok(headed("ARGUMENTS", lines))
}

fn stdin_section(subject: &Subject<'_>) -> Vec<String> {
    let Some(input) = &subject.command.stdin else {
        return Vec::new();
    };
    let path = path_of(subject.graph, subject.command);
    let mut lines = Vec::new();
    if let Some(summary) = input.description.as_deref().map(single_line) {
        lines.push(text_line(&escape(&summary)));
    }
    let presence = if input.required {
        "Required."
    } else {
        "Optional."
    };
    lines.push(text_line(&escape(&format!(
        "{presence} Reads piped or redirected stdin. Terminal input is not accepted."
    ))));
    lines.push(text_line(&escape(&format!("Example: <producer> | {path}"))));
    headed("INPUT", lines)
}

/// An option's tag: help's left cell without its indentation, each spelling in bold, each
/// placeholder in italic, and the separators, brackets, `=`, and `...` regular.
fn option_tag(parts: &OptionCellParts) -> String {
    let spellings = [parts.short.as_deref(), parts.long.as_deref()]
        .into_iter()
        .flatten()
        .map(|spelling| in_font(spelling, Font::Bold, Fill::Fill))
        .collect::<Vec<_>>()
        .join(", ");
    if parts.trailing_ellipsis {
        return format!("{spellings}...");
    }
    match &parts.value {
        None => spellings,
        Some(value) => {
            let word = format!(
                "{}{}{}",
                escape(value.before),
                in_font(&value.placeholder, Font::Italic, Fill::Fill),
                escape(value.after),
            );
            let words = std::iter::repeat_n(word.as_str(), value.words)
                .collect::<Vec<_>>()
                .join(" ");
            format!("{spellings}{}{words}", escape(value.separator))
        }
    }
}

/// The variables an option binds.
fn env_of(option: &OptionNode) -> &[String] {
    match option {
        OptionNode::String(node) => &node.env,
        OptionNode::Content(node) => &node.env,
        OptionNode::Boolean(node) => &node.env,
        OptionNode::Count(node) => &node.env,
        _ => &[],
    }
}

/// The delimiter a multiple option's variable is a list under, as help writes it, with a space
/// that never breaks the line, or none for an option whose variable holds one value.
fn list_delimiter(option: &OptionNode) -> Option<String> {
    delimiter_literal(option).map(|literal| escape_unbroken(&literal))
}

/// The lines an option's entry adds after its text: its environment and configuration bindings.
fn bindings(option: &ReadOption) -> Vec<String> {
    let node = option.node.as_ref();
    let env = env_of(node);
    let mut lines = Vec::new();
    if !env.is_empty() {
        let names: Vec<String> = env
            .iter()
            .map(|name| in_font(name, Font::Bold, Fill::Fill))
            .collect();
        let list = list_delimiter(node)
            .map(|delimiter| format!(" ({} separated by {delimiter})", split_noun(node)))
            .unwrap_or_default();
        lines.push(format!("Environment: {}{list}", names.join(", ")));
    }
    if let Some(path) = &option.help.config_path {
        lines.push(format!(
            "Configuration: {}",
            in_font(path, Font::Bold, Fill::Fill)
        ));
    }
    lines
}

fn option_entry(option: &&ReadOption) -> Vec<String> {
    let parts = option_cell_parts(&option.node, &option.help);
    entry(
        &option_tag(&parts),
        &entry_text(
            option_description(&option.node),
            option_accepts(option).as_deref(),
            &unbound_option_facts(&option.node),
        ),
        &bindings(option),
    )
}

/// The spelling an ENVIRONMENT entry names: the tag's long spelling, or its short one.
fn supplied_spelling(option: &ReadOption) -> String {
    let parts = option_cell_parts(&option.node, &option.help);
    parts.long.or(parts.short).unwrap_or_default()
}

fn environment(subject: &Subject<'_>) -> Vec<String> {
    let mut lines = Vec::new();
    for option in listed(&subject.option_sections) {
        let node = option.node.as_ref();
        for name in env_of(node) {
            let list = list_delimiter(node)
                .map(|delimiter| format!(" as {} separated by {delimiter}", split_noun(node)))
                .unwrap_or_default();
            let empty = match node {
                OptionNode::String(string) if string.env_allow_empty => {
                    ", even with an empty value"
                }
                _ => "",
            };
            lines.extend(entry(
                &in_font(name, Font::Bold, Fill::Fill),
                &format!(
                    "Supplies {}{list}{empty}.",
                    in_font(&supplied_spelling(option), Font::Bold, Fill::Fill)
                ),
                &[],
            ));
        }
    }
    headed("ENVIRONMENT", lines)
}

/// One example: its command in bold as one no-fill line, then its note indented under it.
fn example_lines(name: &str, example: &CommandExample) -> Vec<String> {
    let mut lines = vec![
        ".nf".to_owned(),
        text_line(&in_font(
            &format!("$ {name} {}", example.command),
            Font::Bold,
            Fill::NoFill,
        )),
        ".fi".to_owned(),
    ];
    if let Some(note) = &example.note {
        lines.push(format!(".RS {NOTE_INDENT}"));
        lines.push(text_line(&escape(note)));
        lines.push(".RE".to_owned());
    }
    lines
}

/// Each example, a `.PP` between one and the next.
fn examples(subject: &Subject<'_>) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for example in &subject.examples {
        if !lines.is_empty() {
            lines.push(".PP".to_owned());
        }
        lines.extend(example_lines(&subject.graph.name, example));
    }
    headed("EXAMPLES", lines)
}

/// The epilogs the help page ends with, in its order, or no section when the path holds none.
fn notes(subject: &Subject<'_>) -> Result<Vec<String>, Error> {
    let epilogs = epilogs_of(subject.graph, subject.command)?;
    Ok(headed("NOTES", notes_lines(&epilogs)))
}

/// The root page, the parent's page when it is not the root, then each visible child's page.
fn see_also(subject: &Subject<'_>) -> Vec<String> {
    let graph = subject.graph;
    let mut named: Vec<&CommandNode> = Vec::new();
    if let Some(parent) = subject.parent {
        named.push(graph.root.as_ref());
        if !parent.path.is_empty() {
            named.push(parent);
        }
    }
    named.extend(
        listed(&subject.command_sections)
            .into_iter()
            .map(|child| child.as_ref()),
    );
    let pages: Vec<String> = named
        .iter()
        .map(|node| {
            format!(
                "{}({SECTION})",
                in_font(&page_name(graph, node), Font::Bold, Fill::Fill)
            )
        })
        .collect();
    if pages.is_empty() {
        return pages;
    }
    headed("SEE ALSO", vec![pages.join(", ")])
}

/// The text of one page: its sections in order, each omitted when it has nothing to show, every
/// line ended by a line feed. `parent` is the Command the page's Command is under, `None` for the
/// root.
fn render_page(
    graph: &CommandGraph,
    command: &CommandNode,
    parent: Option<&CommandNode>,
) -> Result<String, Error> {
    let children: Vec<Arc<CommandNode>> = command
        .children
        .iter()
        .filter(|child| !child.hidden)
        .cloned()
        .collect();
    let help = command_help(command)?;
    let locals = read_options(&command.options)?;
    let globals = if parent.is_none() {
        read_options(&graph.globals)?
    } else {
        Vec::new()
    };
    let global_heading = if graph.root.children.is_empty() {
        "OPTIONS"
    } else {
        "GLOBAL OPTIONS"
    };
    let option_members = locals
        .iter()
        .map(|option| ("OPTIONS", option))
        .chain(globals.iter().map(|option| (global_heading, option)))
        .map(|(fallback, option)| SectionMember {
            fallback,
            path: option.section.clone(),
            row: option,
        })
        .collect();
    let command_members = children
        .iter()
        .map(|child| {
            Ok(SectionMember {
                fallback: "COMMANDS",
                path: command_help(child)?.section,
                row: child,
            })
        })
        .collect::<Result<Vec<_>, Error>>()?;
    let subject = Subject {
        graph,
        command,
        parent,
        children: children.clone(),
        locals: &locals,
        command_sections: ordered_sections(help.command_sections.as_deref(), command_members),
        option_sections: ordered_sections(help.option_sections.as_deref(), option_members),
        examples: help.examples.unwrap_or_default(),
        details: help.details,
    };
    let mut lines = Vec::new();
    lines.extend(title(&subject));
    lines.extend(name_section(&subject));
    lines.extend(synopsis(&subject));
    lines.extend(description(&subject));
    lines.extend(section_lines(&subject.command_sections, child_entry));
    lines.extend(arguments_section(&subject)?);
    lines.extend(stdin_section(&subject));
    lines.extend(section_lines(&subject.option_sections, option_entry));
    lines.extend(examples(&subject));
    lines.extend(environment(&subject));
    lines.extend(notes(&subject)?);
    lines.extend(see_also(&subject));
    let mut text = lines
        .iter()
        .map(|line| line.trim_end())
        .collect::<Vec<_>>()
        .join("\n");
    text.push('\n');
    Ok(text)
}

/// The page set of a graph: one page for the root and each findable Command, in graph order.
///
/// # Errors
///
/// A stored help or configuration value the descriptors cannot read, as the read's own fault.
pub fn man_pages(graph: &CommandGraph) -> Result<Vec<ManPage>, Error> {
    findable(graph)
        .iter()
        .map(|found| {
            Ok(ManPage {
                file: page_file(&page_name(graph, &found.command)),
                text: render_page(graph, &found.command, found.parent.as_deref())?,
            })
        })
        .collect()
}
