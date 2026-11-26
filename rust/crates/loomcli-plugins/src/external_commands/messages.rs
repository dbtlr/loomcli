//! Operator sentences and log templates for external commands.

use loomcli_core::{LogFields, escape_control_characters};

pub(super) fn cannot_run(application: &str, program: &str, code: Option<&str>) -> String {
    let application = escape_control_characters(application);
    let program = escape_control_characters(program);
    let reason = match code {
        Some("EACCES") => "the system does not allow it to run. Check its permissions and the file system it is on, or remove it from PATH.".to_owned(),
        Some("ENOENT") => "the interpreter its first line names, or the file itself, is missing. Install the interpreter, or remove the file from PATH.".to_owned(),
        Some("ENOEXEC") => "this system cannot run it as a program. Replace it with a program for this system, or remove it from PATH.".to_owned(),
        Some(code) => {
            let code = escape_control_characters(code);
            format!("the system refused to start it ({code}). Check that it is a program this system can run, or remove it from PATH.")
        }
        None => "the system refused to start it. Check that it is a program this system can run, or remove it from PATH.".to_owned(),
    };
    format!("{application} cannot run {program}, because {reason}")
}

pub(super) fn running(program: &str) -> (&'static str, LogFields) {
    (
        "Running {program}.",
        LogFields::new().field("program", escape_control_characters(program)),
    )
}

pub(super) fn not_in(program: &str, folder: &str) -> (&'static str, LogFields) {
    (
        "No {program} in {folder}.",
        LogFields::new()
            .field("folder", escape_control_characters(folder))
            .field("program", escape_control_characters(program)),
    )
}
