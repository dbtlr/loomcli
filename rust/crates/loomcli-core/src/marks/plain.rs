//! The plain switch, settled from the captured environment and the marked long spellings.

use super::marked;
use crate::application::declaration::ApplicationDeclaration;
use crate::host::Env;

/// Whether a captured environment turns the plain switch on.
pub(crate) fn accessible(env: &Env) -> bool {
    env.get("ACCESSIBLE").is_some_and(|value| !value.is_empty())
}

/// Whether argv names the mark before the first bare `--`. A value attached to a Boolean
/// spelling matches no entry in the global table.
pub(crate) fn chosen(application: &ApplicationDeclaration, argv: &[String]) -> bool {
    let Some(name) = marked(application, "plain") else {
        return false;
    };
    argv.iter().take_while(|word| *word != "--").any(|word| {
        application
            .global_table
            .table
            .iter()
            .any(|(spelling, entry)| spelling == word && entry.name == name)
    })
}
