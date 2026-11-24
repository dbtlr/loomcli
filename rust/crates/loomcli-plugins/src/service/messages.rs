//! The sentences the service Commands write: the refusals and failures they end with, the lines
//! they print, and the notes status adds. Every path, label, and program name a sentence repeats is
//! escaped as a failure message quotes text, and a path is kept whole when a lane wraps.

use std::io;
use std::path::Path;
use std::sync::Arc;

use loomcli_core::{Error, FatalError, escape_control_characters, nowrap};

/// Text escaped as a failure message quotes it.
pub(super) fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// A file-system path escaped as a failure message quotes text, and kept whole when a lane wraps.
pub(super) fn shown_path(path: &Path) -> String {
    nowrap(&escape_control_characters(&path.to_string_lossy()))
}

/// The children whose record refusal a sentence names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum Child {
    Install,
    Uninstall,
}

impl Child {
    fn word(self) -> &'static str {
        match self {
            Child::Install => "install",
            Child::Uninstall => "uninstall",
        }
    }
}

/// A build that is not distributed cannot install a service that would outlive it.
pub(super) fn build(name: &str, development: bool) -> FatalError {
    let kind = if development {
        "a development build"
    } else {
        "a source build"
    };
    FatalError::new(format!(
        "{name} is {kind}, so it cannot install a service that would outlive it. Build it with cargo loom build, then run the built {name} service install.",
        name = shown(name)
    ))
}

/// The file at the unit's path changed since the plugin recorded it.
pub(super) fn changed(name: &str, path: &Path) -> FatalError {
    FatalError::new(format!(
        "{} changed since {name} service install wrote it, so install leaves it alone. Remove it, then run {name} service install again.",
        shown_path(path),
        name = shown(name)
    ))
}

/// A path or the description holds a control character the unit file cannot hold.
pub(super) fn control_character(name: &str) -> FatalError {
    FatalError::new(format!(
        "{name} cannot write its service unit because a path or its description holds a control character. Install {name} where its path has none.",
        name = shown(name)
    ))
}

/// The home is not an absolute path, so the unit cannot be placed or run from it.
pub(super) fn home(name: &str) -> FatalError {
    FatalError::new(format!(
        "{} cannot find its service unit because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.",
        shown(name)
    ))
}

/// The file at the unit's path is a link, a directory, or another kind of file.
pub(super) fn irregular(name: &str, path: &Path) -> FatalError {
    FatalError::new(format!(
        "{} is not a regular file, so install leaves it alone. Remove it, then run {name} service install again.",
        shown_path(path),
        name = shown(name)
    ))
}

/// `start`, `stop`, and `restart` with no file at the unit's path.
pub(super) fn not_installed(name: &str, label: &str) -> FatalError {
    FatalError::new(format!(
        "{} is not installed. Run {} service install first.",
        shown(label),
        shown(name)
    ))
}

/// A platform with neither manager.
pub(super) fn platform(name: &str, platform: &str) -> FatalError {
    FatalError::new(format!(
        "{} cannot run a service on {}. Run it on Linux with systemd or macOS with launchd.",
        shown(name),
        shown(platform)
    ))
}

/// The plugin's file in the installation record cannot be read.
pub(super) fn record(name: &str, record: &Path, child: Child) -> FatalError {
    FatalError::new(format!(
        "{} cannot be read, so {name} will not change the files it lists. Remove it and the files it lists, then run {name} service {child} again.",
        shown_path(record),
        name = shown(name),
        child = child.word()
    ))
}

/// A file the plugin did not record is at the unit's path, in the way of `install`.
pub(super) fn unrecorded(name: &str, path: &Path) -> FatalError {
    FatalError::new(format!(
        "{} was not written by {name} service install, so install leaves it alone. Remove it, or uninstall it with whatever installed it, then run {name} service install again.",
        shown_path(path),
        name = shown(name)
    ))
}

/// A file the plugin did not record is at the unit's path, in the way of `uninstall`.
pub(super) fn unrecorded_uninstall(name: &str, path: &Path) -> FatalError {
    FatalError::new(format!(
        "{} was not written by {name} service install, so uninstall leaves it alone. Remove it with whatever installed it.",
        shown_path(path),
        name = shown(name)
    ))
}

/// The package each manager program comes with.
fn package_of(program: &str) -> &str {
    match program {
        "launchctl" => "launchd",
        "loginctl" | "systemctl" => "systemd",
        other => other,
    }
}

/// The sentence for a manager program that cannot be started.
pub(super) fn missing_sentence(name: &str, program: &str) -> String {
    format!(
        "{} cannot find {}. Install {}, or run the command where it is available.",
        shown(name),
        shown(program),
        shown(package_of(program))
    )
}

/// A manager program that cannot be started, failing the child.
pub(super) fn missing(name: &str, program: &str, cause: &Arc<io::Error>) -> Error {
    FatalError::with_cause(
        missing_sentence(name, program),
        Error::from(Arc::clone(cause)),
    )
    .into()
}

/// A manager call that exits with a code the child does not name.
pub(super) fn exited(call: &str, code: i32, report: &str) -> FatalError {
    FatalError::new(format!(
        "{} exited with {code}. Run {} to see why.",
        shown(call),
        shown(report)
    ))
}

/// The line for a recorded file already gone.
pub(super) fn gone(path: &Path) -> String {
    format!("{} was already gone.", shown_path(path))
}

/// The line for a recorded file kept because it changed.
pub(super) fn kept(name: &str, path: &Path) -> String {
    format!(
        "Kept {} because it changed since {} service install wrote it. Remove it yourself when it is no longer needed.",
        shown_path(path),
        shown(name)
    )
}

/// The line `uninstall` prints when nothing is installed.
pub(super) fn nothing_to_remove(label: &str) -> String {
    format!(
        "{} is not installed, so there is nothing to remove.",
        shown(label)
    )
}

/// The line for a removed file.
pub(super) fn removed(path: &Path) -> String {
    format!("Removed {}.", shown_path(path))
}

/// The line `restart` prints.
pub(super) fn restarted(label: &str) -> String {
    format!("Restarted {}.", shown(label))
}

/// The line `install` and `start` print.
pub(super) fn started(label: &str) -> String {
    format!("Started {}.", shown(label))
}

/// The line `stop` prints.
pub(super) fn stopped(label: &str) -> String {
    format!("Stopped {}.", shown(label))
}

/// The line for a unit file that already holds the rendered text.
pub(super) fn unchanged(path: &Path) -> String {
    format!("{} is unchanged.", shown_path(path))
}

/// The line for a unit file written.
pub(super) fn wrote(path: &Path) -> String {
    format!("Wrote {}.", shown_path(path))
}

/// The call a status note names: the manager, what it was asked about, and its own report.
pub(super) struct UnreadableCall<'a> {
    pub(super) manager: &'a str,
    pub(super) target: &'a str,
    pub(super) report: &'a str,
}

/// The note `Linger=no` adds.
pub(super) fn linger(label: &str) -> String {
    format!(
        "Lingering is off, so {label} stops when you log out. Run loginctl enable-linger to keep it running."
    )
}

/// The note a domain with no login session adds.
pub(super) fn no_session(label: &str) -> String {
    format!("There is no login session, so {label} starts when you log in.")
}

/// The note of a state read that ran out.
pub(super) fn timed_out(call: &UnreadableCall<'_>, seconds: u64) -> String {
    format!(
        "{} did not report {} within {seconds} seconds, so status ended the call. Run {} to see why.",
        call.manager, call.target, call.report
    )
}

/// The note of a state read that exited with a code the reading does not name.
pub(super) fn unreadable(call: &UnreadableCall<'_>, code: i32) -> String {
    format!(
        "{} could not report {} (exit {code}). Run {} to see why.",
        call.manager, call.target, call.report
    )
}
