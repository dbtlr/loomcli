//! Validates Command paths and orders their references by the built graph.

use std::collections::{HashMap, HashSet};

use loomcli_core::{
    CommandGraph, CommandNode, DeclarationError, DiagnosticParts, DiagnosticRule, diagnostic_rule,
};

use super::messages;

pub(super) const REFERENCES: &str = "references/commands/";
pub(super) const INDEX: &str = "index.md";

const COMMANDS: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/skills/commands",
    "Unknown skill command path",
    "A skill selects the Commands whose references the skills plugin generates by their paths, each path the names of the Commands on the way down from the root, so a path whose names lead to no Command the application holds selects nothing the author meant, and the skill would install without the reference it was meant to carry.",
);

const REFERENCE_NAME_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/skills/reference-name-taken",
    "Command reference name taken",
    "The skills plugin writes one command reference for each Command a skill selects, named by the application name and the Command's path joined with hyphens, beside the skill's index.md, so a Command named with a hyphen can give the name of a child's command reference, the root of an application named index gives the name of the index, and one file would replace the other.",
);

/// A skill and the canonical Command paths it selects.
#[derive(Clone, Debug)]
pub(super) struct Selection {
    pub(super) skill: String,
    pub(super) paths: Vec<Vec<String>>,
}

pub(super) fn collect_paths(
    paths: impl IntoIterator<Item = impl IntoIterator<Item = impl AsRef<str>>>,
) -> Vec<Vec<String>> {
    paths
        .into_iter()
        .map(|path| {
            path.into_iter()
                .map(|name| name.as_ref().to_owned())
                .collect()
        })
        .collect()
}

pub(super) fn reference_name(graph: &CommandGraph, command: &CommandNode) -> String {
    let words: Vec<_> = std::iter::once(graph.name.as_str())
        .chain(command.path.iter().map(String::as_str))
        .collect();
    format!("{}.md", words.join("-"))
}

fn walk<'a>(
    command: &'a CommandNode,
    inherited: bool,
    named: &HashSet<&[String]>,
    filed: &mut Vec<&'a CommandNode>,
) {
    let selected = inherited || named.contains(command.path.as_slice());
    if selected {
        filed.push(command);
    }
    for child in command.children.iter().filter(|child| !child.hidden) {
        walk(child, selected, named, filed);
    }
}

fn fault(rule: DiagnosticRule, (sentence, correction): (String, &'static str)) -> DeclarationError {
    DeclarationError::new(rule, DiagnosticParts::new(sentence).correction(correction))
}

pub(super) fn selected_commands<'a>(
    graph: &'a CommandGraph,
    paths: &[Vec<String>],
    skill: Option<&str>,
) -> Result<Vec<&'a CommandNode>, DeclarationError> {
    let mut named = HashSet::new();
    for path in paths {
        let words = path.iter().map(String::as_str).collect::<Vec<_>>();
        let Some(command) = graph.command(&words) else {
            return Err(fault(COMMANDS, messages::unknown_command_path(skill, path)));
        };
        named.insert(command.path.as_slice());
    }
    let mut commands = Vec::new();
    walk(&graph.root, false, &named, &mut commands);
    let mut seen = HashMap::new();
    for command in &commands {
        let file = reference_name(graph, command);
        if file == INDEX {
            return Err(fault(
                REFERENCE_NAME_TAKEN,
                messages::root_is_index(skill, &graph.name),
            ));
        }
        if let Some(earlier) = seen.insert(file.clone(), command.path.join(" ")) {
            return Err(fault(
                REFERENCE_NAME_TAKEN,
                messages::reference_name_taken(skill, &earlier, &command.path.join(" "), &file),
            ));
        }
    }
    Ok(commands)
}

/// A selecting skill gives Loom the index and application reference names at this depth.
pub(super) fn owns_reference(path: &str, application: &str) -> bool {
    let Some(file) = path.strip_prefix(REFERENCES) else {
        return false;
    };
    if file.contains('/') {
        return false;
    }
    file == INDEX
        || file.strip_prefix(application).is_some_and(|suffix| {
            suffix == ".md" || (suffix.starts_with('-') && suffix.ends_with(".md"))
        })
}
