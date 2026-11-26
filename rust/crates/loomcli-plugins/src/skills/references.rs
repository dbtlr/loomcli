//! Renders the selected Commands and their index from the built graph.

use loomcli_core::{CommandGraph, CommandNode, Error, ResultKindName, read_extension};
use serde_json::Value;

use super::extension::SKILL_COMMAND;
use super::markdown::{authored, code_span, shown_text};
use super::messages;
use super::selection::{INDEX, collect_paths, reference_name, selected_commands};
use crate::help::cells::{
    Fact, PlainCell, UsageStyle, option_cell_parts, option_facts, right_cell,
};
use crate::help::messages::{TERMINAL_NEED_LABEL, TERMINAL_NEED_TEXT};
use crate::help::page::{
    ReadOption, argument_rows, option_accepts, option_description, option_group_sentences, path_of,
    read_options, stdin_parts, usage_forms,
};
use crate::manifest::extension::MANIFEST_COMMAND;

/// One generated Markdown file, derived from the Command graph.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct CommandReference {
    /// The file name, such as the index or an application and Command path joined with hyphens.
    pub name: String,
    /// The file's Markdown, with a trailing line feed.
    pub content: String,
}

/// Renders the command references for canonical paths in the built graph. The index comes first,
/// followed by each selected visible Command in graph order. The empty path selects the root.
/// When `guidance` is true, each Command reference includes its skill guidance.
///
/// # Errors
///
/// A declaration failure when a path names no Command or two references have the same file name.
/// Also returns an error if reading an extension from the graph fails.
pub fn command_references(
    graph: &CommandGraph,
    paths: impl IntoIterator<Item = impl IntoIterator<Item = impl AsRef<str>>>,
    guidance: bool,
) -> Result<Vec<CommandReference>, Error> {
    render(graph, &collect_paths(paths), guidance, None)
}

pub(super) fn render(
    graph: &CommandGraph,
    paths: &[Vec<String>],
    guidance: bool,
    skill: Option<&str>,
) -> Result<Vec<CommandReference>, Error> {
    let commands = selected_commands(graph, paths, skill)?;
    if commands.is_empty() {
        return Ok(Vec::new());
    }
    let mut files = vec![CommandReference {
        name: INDEX.to_owned(),
        content: index(graph, &commands)?,
    }];
    for command in commands {
        files.push(CommandReference {
            name: reference_name(graph, command),
            content: reference(graph, command, guidance)?,
        });
    }
    Ok(files)
}

fn paragraph(text: &str) -> String {
    shown_text(text, true)
}

fn inline(text: &str) -> String {
    shown_text(text, false)
}

fn item(label: &str, text: &str) -> String {
    let label = code_span(label);
    if text.is_empty() {
        format!("- {label}")
    } else {
        format!("- {label}: {text}")
    }
}

fn cell(description: Option<&str>, accepts: Option<&str>, facts: &[Fact]) -> String {
    inline(&right_cell(description, accepts, facts, &PlainCell))
}

fn option_entry(option: &ReadOption) -> String {
    let parts = option_cell_parts(&option.node, &option.help);
    let mut label = parts.long.or(parts.short).unwrap_or_default();
    if parts.trailing_ellipsis {
        label.push_str("...");
    } else if let Some(value) = parts.value {
        label.push_str(value.separator);
        let word = format!("{}{}{}", value.before, value.placeholder, value.after);
        label.push_str(
            &std::iter::repeat_n(word.as_str(), value.words)
                .collect::<Vec<_>>()
                .join(" "),
        );
    }
    item(
        &label,
        &cell(
            option_description(&option.node),
            option_accepts(option).as_deref(),
            &option_facts(&option.node, &option.help),
        ),
    )
}

fn section(document: &mut Vec<String>, name: &str, blocks: Vec<String>) {
    if !blocks.is_empty() {
        document.push(format!("## {name}"));
        document.extend(blocks);
    }
}

fn list(lines: Vec<String>) -> Vec<String> {
    if lines.is_empty() {
        Vec::new()
    } else {
        vec![lines.join("\n")]
    }
}

fn file_text(blocks: &[String]) -> String {
    format!("{}\n", blocks.join("\n\n"))
}

struct PlainUsage;

impl UsageStyle for PlainUsage {
    fn path(&self, text: &str) -> String {
        text.to_owned()
    }

    fn spelling(&self, text: &str) -> String {
        text.to_owned()
    }

    fn word(&self, text: &str) -> String {
        text.to_owned()
    }
}

fn opening(graph: &CommandGraph, command: &CommandNode) -> Vec<String> {
    let mut blocks = vec![format!("# {}", inline(&path_of(graph, command)))];
    if !command.aliases.is_empty() {
        blocks.push(paragraph(&messages::reference_aliases(
            &command.aliases,
            true,
        )));
    }
    if command.needs_terminal {
        blocks.push(format!("{TERMINAL_NEED_LABEL}{TERMINAL_NEED_TEXT}"));
    }
    if let Some(deprecated) = &command.deprecated {
        blocks.push(format!("Deprecated: {}", inline(deprecated)));
    }
    if let Some(description) = &command.description {
        blocks.push(paragraph(description));
    }
    blocks
}

fn usage(graph: &CommandGraph, command: &CommandNode, options: &[ReadOption]) -> Vec<String> {
    let visible_child = command.children.iter().any(|child| !child.hidden);
    let mut forms = usage_forms(command, graph, options, visible_child, &PlainUsage);
    let needs_producer =
        command.has_action && command.stdin.as_ref().is_some_and(|input| input.required);
    if forms.is_empty() {
        return Vec::new();
    }
    if needs_producer && let Some(first) = forms.first_mut() {
        first.insert_str(0, "<producer> | ");
    }
    vec![format!(
        "\x60\x60\x60text\n{}\n\x60\x60\x60",
        forms.join("\n")
    )]
}

fn arguments(command: &CommandNode) -> Result<Vec<String>, Error> {
    let visible_child = command.children.iter().any(|child| !child.hidden);
    let items = argument_rows(command, visible_child)?
        .into_iter()
        .map(|row| {
            item(
                &format!("{}{}", row.lead, row.word),
                &cell(row.description, row.accepts.as_deref(), &row.facts),
            )
        })
        .collect();
    Ok(list(items))
}

fn input(graph: &CommandGraph, command: &CommandNode) -> Vec<String> {
    let Some(parts) = stdin_parts(command, &path_of(graph, command)) else {
        return Vec::new();
    };
    [
        parts.summary.as_deref(),
        Some(parts.sentence),
        Some(&parts.example),
    ]
    .into_iter()
    .flatten()
    .map(paragraph)
    .collect()
}

fn result(command: &CommandNode) -> Vec<String> {
    let Some(result) = &command.result else {
        return Vec::new();
    };
    let kind = match result.kind {
        ResultKindName::Rows => "rows",
        ResultKindName::Value => "value",
    };
    let views = result
        .views
        .iter()
        .map(|view| {
            let label = code_span(view);
            if view == &result.default {
                format!("{label} (default)")
            } else {
                label
            }
        })
        .collect::<Vec<_>>()
        .join(", ");
    vec![format!("Kind: {}. Views: {views}.", code_span(kind))]
}

fn reference(graph: &CommandGraph, command: &CommandNode, guidance: bool) -> Result<String, Error> {
    let mut blocks = opening(graph, command);
    let local = read_options(&command.options)?;
    section(&mut blocks, "Usage", usage(graph, command, &local));
    section(&mut blocks, "Arguments", arguments(command)?);
    section(&mut blocks, "Input", input(graph, command));
    let mut options = list(local.iter().map(option_entry).collect());
    options.extend(option_group_sentences(command).map(|sentence| paragraph(&sentence)));
    section(&mut blocks, "Options", options);
    section(&mut blocks, "Result", result(command));
    if guidance && let Some(facts) = read_extension(command, &SKILL_COMMAND)? {
        section(&mut blocks, "Guidance", vec![authored(&facts.guidance)]);
    }
    let facts = read_extension(command, &MANIFEST_COMMAND)?;
    section(
        &mut blocks,
        "Details",
        facts
            .iter()
            .filter_map(|value| value.details.as_deref())
            .map(authored)
            .collect(),
    );
    let examples = facts
        .iter()
        .flat_map(|value| &value.examples)
        .map(|example| {
            let invocation = format!("{} {}", graph.name, example.command);
            let note = example.note.as_deref().map(inline).unwrap_or_default();
            item(&invocation, &note)
        });
    section(&mut blocks, "Examples", list(examples.collect()));
    let failures = facts
        .iter()
        .flat_map(|value| &value.failures)
        .map(|failure| {
            format!(
                "- {} (exit {}): {}",
                code_span(&failure.code),
                failure.exit_code,
                inline(&failure.meaning)
            )
        });
    section(&mut blocks, "Failures", list(failures.collect()));
    Ok(file_text(&blocks))
}

fn index_entry(graph: &CommandGraph, command: &CommandNode) -> String {
    let path = inline(&path_of(graph, command));
    let file = reference_name(graph, command);
    let mut entry = format!("- [{path}]({file})");
    if let Some(description) = &command.description {
        entry.push_str(&format!(": {}", inline(description)));
    }
    let mut facts = Vec::new();
    if !command.aliases.is_empty() {
        facts.push(messages::reference_aliases(&command.aliases, false));
    }
    if command.needs_terminal {
        facts.push("needs a terminal".to_owned());
    }
    if command.deprecated.is_some() {
        facts.push("deprecated".to_owned());
    }
    if !facts.is_empty() {
        entry.push_str(&format!(" ({})", facts.join(", ")));
    }
    entry
}

fn index(graph: &CommandGraph, commands: &[&CommandNode]) -> Result<String, Error> {
    let name = Value::from(graph.name.as_str());
    let version = Value::from(graph.version.as_str());
    let mut blocks = vec![
        format!("---\napplication: {name}\nversion: {version}\n---"),
        format!("# {} commands", inline(&graph.name)),
        commands
            .iter()
            .map(|command| index_entry(graph, command))
            .collect::<Vec<_>>()
            .join("\n"),
    ];
    let globals = read_options(&graph.globals)?;
    section(
        &mut blocks,
        "Global options",
        list(globals.iter().map(option_entry).collect()),
    );
    Ok(file_text(&blocks))
}
