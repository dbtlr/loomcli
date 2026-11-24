//! The page set: one page for the root and for every Command that is not hidden and has no hidden
//! ancestor, named like git's pages, and the judgment that no two Commands give one name.

use std::collections::HashMap;
use std::sync::Arc;

use loomcli_core::{
    CommandGraph, CommandNode, DeclarationError, DiagnosticParts, DiagnosticRule, Error,
    diagnostic_rule,
};

/// Two findable Commands that give one man page name.
const PAGE_NAME_TAKEN: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/manpage/page-name-taken",
    "Man page name taken",
    "The manpage plugin writes one page for each Command an operator can find, named by the application name and the Command's path joined with hyphens, so a Command named with a hyphen can give the name of a child's page, and one page would replace the other.",
);

/// One findable Command with the Command it is under, `None` for the root.
pub(super) struct Findable {
    pub(super) command: Arc<CommandNode>,
    pub(super) parent: Option<Arc<CommandNode>>,
}

/// A Command, then each visible child and its findable descendants, in graph order.
fn walk(command: &Arc<CommandNode>, parent: Option<&Arc<CommandNode>>, found: &mut Vec<Findable>) {
    found.push(Findable {
        command: Arc::clone(command),
        parent: parent.map(Arc::clone),
    });
    for child in command.children.iter().filter(|child| !child.hidden) {
        walk(child, Some(command), found);
    }
}

/// The root, then each visible child and its findable descendants, in graph order.
pub(super) fn findable(graph: &CommandGraph) -> Vec<Findable> {
    let mut found = Vec::new();
    walk(&graph.root, None, &mut found);
    found
}

/// A page's name: the application name, then each name on the Command's path, joined with `-`.
pub(super) fn page_name(graph: &CommandGraph, command: &CommandNode) -> String {
    std::iter::once(graph.name.as_str())
        .chain(command.path.iter().map(String::as_str))
        .collect::<Vec<_>>()
        .join("-")
}

/// A page's file: its name in section 1.
pub(super) fn page_file(name: &str) -> String {
    format!("{name}.1")
}

/// The fault of two Commands that give one page name.
fn name_taken(earlier: &CommandNode, later: &CommandNode, name: &str) -> DeclarationError {
    DeclarationError::new(
        PAGE_NAME_TAKEN,
        DiagnosticParts::new(format!(
            "Commands \"{}\" and \"{}\" both give the man page {name}.",
            earlier.path.join(" "),
            later.path.join(" ")
        ))
        .correction("Rename one of them, or hide one."),
    )
}

/// Judges the page names of every build: no two findable Commands give one name, as `config-set`
/// and `config set` do. A hidden Command gives no page, so it collides with nothing.
pub(super) fn judge_page_names(graph: &CommandGraph) -> Result<(), Error> {
    let mut seen: HashMap<String, Arc<CommandNode>> = HashMap::new();
    for Findable { command, .. } in findable(graph) {
        let name = page_name(graph, &command);
        if let Some(earlier) = seen.get(&name) {
            return Err(name_taken(earlier, &command, &name).into());
        }
        seen.insert(name, command);
    }
    Ok(())
}
