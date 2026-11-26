//! The sentences of the installed-files module: the refusals of a host that cannot name a folder, and the text of its errors.

use loomcli_core::escape_control_characters;

pub(super) fn home_not_absolute(name: &str) -> String {
    format!(
        "{} cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.",
        escape_control_characters(name)
    )
}

pub(super) fn record_directory_not_absolute(name: &str, variable: &str) -> String {
    let variable = escape_control_characters(variable);
    format!(
        "{} cannot find its installation record because {variable} is not an absolute path. Set {variable} to an absolute path, then run the command again.",
        escape_control_characters(name)
    )
}

pub(super) const RUN_CANCELLED: &str = "The run was cancelled.";

pub(super) const PATH_NOT_UTF8: &str =
    "The installation record holds UTF-8 paths, and a path is not UTF-8.";

pub(super) fn startup_file_unreadable(path: &str) -> String {
    format!(
        "Startup file \"{}\" is one the process may not read.",
        escape_control_characters(path)
    )
}

pub(super) fn startup_file_encoding(path: &str) -> String {
    format!(
        "Startup file \"{}\" is not in an encoding the module reads.",
        escape_control_characters(path)
    )
}

pub(super) fn startup_file_changed(path: &str) -> String {
    format!(
        "Startup file \"{}\" changed while its line was added.",
        escape_control_characters(path)
    )
}

fn shown_path(path: &std::path::Path) -> String {
    loomcli_core::nowrap(&escape_control_characters(&path.to_string_lossy()))
}

pub(super) fn path_blocked(path: &std::path::Path) -> String {
    format!(
        "Cannot reach {} because a file sits where one of its folders is needed. Remove or rename that file, then run the command again.",
        shown_path(path)
    )
}

pub(super) fn read_unreadable(path: &std::path::Path) -> String {
    format!(
        "Cannot read {} because you do not have permission to reach or read it. Make it readable, then run the command again.",
        shown_path(path)
    )
}

pub(super) fn write_unwritable(path: &std::path::Path, read_only: bool) -> String {
    let reason = if read_only {
        "the file system is read-only"
    } else {
        "you do not have permission to write there"
    };
    format!(
        "Cannot write {} because {reason}. Make the location writable, then run the command again.",
        shown_path(path)
    )
}
