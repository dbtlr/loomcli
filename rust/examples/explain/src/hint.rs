//! The failure hint.

use loomcli_core::{Failure, FailureHookContext, InvokedBy, UnknownOptionError};

/// Points an operator who typed an unknown option at the explanation of the Command they reached.
/// The command line is the application name, the routed path, and `--explain`, which are declared
/// names, so the hint interpolates nothing the operator typed. An invocation by name has no command
/// line to rerun, so it gets no hint.
pub(crate) fn explain_hint(failure: &dyn Failure, context: &FailureHookContext) -> Option<String> {
    if !failure.is::<UnknownOptionError>() || context.invoked_by != InvokedBy::Argv {
        return None;
    }
    let command: Vec<&str> = std::iter::once(context.application.as_str())
        .chain(context.path.iter().map(String::as_str))
        .chain(std::iter::once("--explain"))
        .collect();
    Some(format!(
        "Run \"{}\" to explain this command.",
        command.join(" ")
    ))
}
