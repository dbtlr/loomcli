//! The graph check: the run words must route to a Command that has an action.

use loomcli_core::{
    CommandGraph, DeclarationError, DiagnosticParts, DiagnosticRule, Error, WordPosition,
    diagnostic_rule, escape_control_characters, locate,
};

use crate::PACKAGE_NAME;

/// `@loomcli/plugins/service/run-unrouted`.
const RUN_UNROUTED: DiagnosticRule = diagnostic_rule(
    "@loomcli/plugins/service/run-unrouted",
    "Service run words do not route",
    "The service unit runs the application with the words in run, so they name a Command that has an action, with its options and arguments, as the application's command line takes them. Words that route nowhere would leave the manager restarting a process that fails at once.",
);

/// Whether every run word reads and the routed Command has an action.
fn routes(graph: &CommandGraph, run: &[String]) -> bool {
    let mut words: Vec<&str> = run.iter().map(String::as_str).collect();
    // After a delimiter the last word must itself be an argument or passthrough.
    if !words.contains(&"--") {
        words.push("--");
    }
    match locate(graph, &words) {
        WordPosition::Option { command, .. }
        | WordPosition::Argument { command, .. }
        | WordPosition::Passthrough { command, .. } => command.has_action,
        _ => false,
    }
}

/// Judges the `run` words on every graph build, so a renamed or mistyped Command fails the build
/// rather than a supervised daemon. No validator runs, so a value its validator rejects fails when
/// the unit runs.
pub(super) fn judge_run(graph: &CommandGraph, run: &[String]) -> Result<(), Error> {
    if routes(graph, run) {
        return Ok(());
    }
    let words: Vec<String> = run
        .iter()
        .map(|word| escape_control_characters(word))
        .collect();
    Err(DeclarationError::new(
        RUN_UNROUTED,
        DiagnosticParts::new(format!(
            "Plugin \"{PACKAGE_NAME}/service\" setting \"run\" does not route to a Command with an action: {}.",
            words.join(" ")
        ))
        .correction(
            "Name the words of a Command that has an action, as the application's command line takes them.",
        ),
    )
    .into())
}
