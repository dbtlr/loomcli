//! The sentences of the completion plugin.

use std::path::Path;

use loomcli_core::{escape_control_characters, nowrap};

/// Every path, name, and answer a sentence repeats, escaped as a failure message quotes text.
fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// A filesystem path escaped as a failure message quotes text, and kept whole when a lane wraps.
pub(super) fn shown_path(path: &Path) -> String {
    nowrap(&shown(&path.to_string_lossy()))
}

/// Why PowerShell could not answer with its profile, as the failure sentence states it.
pub(super) enum ProfileFault {
    NotStarted,
    Exited(i32),
    Reported(String),
}

/// The clause and the correction of a profile failure.
fn profile_fault(shell: &str, fault: &ProfileFault) -> String {
    let install = format!("Install {shell}, or name the shell you use.");
    match fault {
        ProfileFault::NotStarted => format!("{shell} could not start. {install}"),
        ProfileFault::Exited(code) => format!("{shell} exited with code {code}. {install}"),
        ProfileFault::Reported(answer) => format!(
            "{shell} reported {}. Check that {shell} -NoProfile -Command $PROFILE prints the path of your profile.",
            shown(answer)
        ),
    }
}

/// The verb of a command that changes files.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Verb {
    Install,
    Update,
    Uninstall,
}

impl Verb {
    fn word(self) -> &'static str {
        match self {
            Verb::Install => "install",
            Verb::Update => "update",
            Verb::Uninstall => "uninstall",
        }
    }
}

pub(super) fn scripts_in_the_way(name: &str, verb: Verb, shell: &str) -> String {
    format!(
        "{n} completion {v} changed nothing, because files it did not install are in the way. Remove them, then run {n} completion install {shell} again.",
        n = shown(name),
        v = verb.word(),
    )
}

pub(super) fn startup_not_a_file(name: &str, startup: &Path) -> String {
    format!(
        "{} is not a file, so {} cannot add its startup line. Remove it, then run {} completion install again.",
        shown_path(startup),
        shown(name),
        shown(name),
    )
}

pub(super) fn installs_not_on_windows(name: &str, printer: &str) -> String {
    format!(
        "{n} completion installs bash, zsh, fish, and pwsh completion on Linux and macOS. Print the script with {n} completion {printer} and load it yourself.",
        n = shown(name),
    )
}

pub(super) fn profile_not_found(name: &str, shell: &str, fault: &ProfileFault) -> String {
    format!(
        "{} cannot find the profile of {shell}, because {}",
        shown(name),
        profile_fault(shell, fault)
    )
}

pub(super) fn record_unreadable(name: &str, record: &Path, verb: Verb) -> String {
    format!(
        "{} cannot be read, so {n} will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run {n} completion {v} again.",
        shown_path(record),
        n = shown(name),
        v = verb.word(),
    )
}

pub(super) fn shell_unknown(name: &str, login: Option<&str>) -> String {
    let value = login.map_or_else(|| "(unset)".to_owned(), shown);
    format!(
        "{n} cannot tell your shell from SHELL ({value}). Name it: {n} completion install bash, zsh, fish, or pwsh.",
        n = shown(name),
    )
}

pub(super) fn add_line_in_place(startup: &Path) -> String {
    format!("Add this line to {} in its place:", shown_path(startup))
}

pub(super) fn add_line_yourself(name: &str, startup: &Path) -> String {
    format!(
        "{} cannot change {}, so add this line to it yourself:",
        shown(name),
        shown_path(startup)
    )
}

pub(super) fn added_line(startup: &Path) -> String {
    format!("Added a line to {} that loads it.", shown_path(startup))
}

pub(super) fn already_loads(startup: &Path) -> String {
    format!("{} already loads it.", shown_path(startup))
}

pub(super) fn script_changed(name: &str, script: &Path) -> String {
    format!(
        "{} changed since {} completion install wrote it.",
        shown_path(script),
        shown(name)
    )
}

pub(super) fn script_gone(script: &Path) -> String {
    format!("{} was already gone.", shown_path(script))
}

pub(super) fn installed_script(shell: &str, script: &Path) -> String {
    format!(
        "Installed the {shell} completion script in {}.",
        shown_path(script)
    )
}

pub(super) fn script_left_in_place(name: &str, script: &Path) -> String {
    format!(
        "{} changed since {} completion install wrote it, so it was left in place.",
        shown_path(script),
        shown(name)
    )
}

pub(super) fn line_no_longer_held(name: &str, startup: &Path) -> String {
    format!(
        "{} no longer holds the line {} completion install added, so it was left as it is.",
        shown_path(startup),
        shown(name)
    )
}

pub(super) fn no_completion_to_remove(name: &str) -> String {
    format!(
        "{} has no completion installed, so there is nothing to remove.",
        shown(name)
    )
}

pub(super) fn no_completion_to_update(name: &str) -> String {
    format!(
        "{n} has no completion installed, so there is nothing to update. Run {n} completion install to install it.",
        n = shown(name)
    )
}

pub(super) fn script_not_installed(name: &str, script: &Path) -> String {
    format!(
        "{} was not installed by {} completion install.",
        shown_path(script),
        shown(name)
    )
}

pub(super) const OPEN_NEW_SHELL: &str = "Open a new shell to use it.";

pub(super) fn remove_line_yourself(name: &str, startup: &Path) -> String {
    format!(
        "{} cannot change {}, so remove this line from it yourself:",
        shown(name),
        shown_path(startup)
    )
}

pub(super) fn removed_file(path: &Path) -> String {
    format!("Removed {}.", shown_path(path))
}

pub(super) fn removed_line(startup: &Path) -> String {
    format!("Removed the line from {}.", shown_path(startup))
}

pub(super) fn script_unchanged(script: &Path) -> String {
    format!("{} is unchanged.", shown_path(script))
}

pub(super) fn updated_script(shell: &str, script: &Path) -> String {
    format!(
        "Updated the {shell} completion script in {}.",
        shown_path(script)
    )
}

pub(super) fn updated_line(startup: &Path) -> String {
    format!("Updated the line in {}.", shown_path(startup))
}

/// The stderr line of a refresh whose binary could not start, ending with a line feed.
pub(super) fn completion_not_refreshed(path: &str, name: &str) -> String {
    format!(
        "Completion was not refreshed because {} could not start. Run {} completion update.\n",
        shown(path),
        shown(name)
    )
}

/// The `warn` log event of a refresh whose child failed or could not start.
pub(super) const COMPLETION_REFRESH_FAILED: &str = "Completion was not refreshed after the update.";
