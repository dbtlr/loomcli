//! The sentences the completion Commands write and the failures they report, pinned by the
//! reference.

use std::path::Path;

use loomcli_core::{
    FatalError, InputIdentity, InputKind, InputProblem, escape_control_characters, nowrap,
};

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

/// The failures a child reports, which exit 1 except `unknown_shell`.
pub(super) mod refusals {
    use super::*;

    pub fn in_the_way(name: &str, verb: Verb, shell: &str) -> FatalError {
        FatalError::new(format!(
            "{n} completion {v} changed nothing, because files it did not install are in the way. Remove them, then run {n} completion install {shell} again.",
            n = shown(name),
            v = verb.word(),
        ))
    }

    pub fn not_a_file(name: &str, startup: &Path) -> FatalError {
        FatalError::new(format!(
            "{} is not a file, so {} cannot add its startup line. Remove it, then run {} completion install again.",
            shown_path(startup),
            shown(name),
            shown(name),
        ))
    }

    pub fn not_on_windows(name: &str, printer: &str) -> FatalError {
        FatalError::new(format!(
            "{n} completion installs bash, zsh, fish, and pwsh completion on Linux and macOS. Print the script with {n} completion {printer} and load it yourself.",
            n = shown(name),
        ))
    }

    pub fn profile(name: &str, shell: &str, fault: &ProfileFault) -> FatalError {
        FatalError::new(format!(
            "{} cannot find the profile of {shell}, because {}",
            shown(name),
            profile_fault(shell, fault)
        ))
    }

    pub fn record(name: &str, record: &Path, verb: Verb) -> FatalError {
        FatalError::new(format!(
            "{} cannot be read, so {n} will not change the files and line it lists. Remove it, the files it lists, and the line it added, then run {n} completion {v} again.",
            shown_path(record),
            n = shown(name),
            v = verb.word(),
        ))
    }

    pub fn unknown_shell(name: &str, login: Option<&str>) -> loomcli_core::InputError {
        let value = login.map_or_else(|| "(unset)".to_owned(), shown);
        loomcli_core::InputError::new(
            format!(
                "{n} cannot tell your shell from SHELL ({value}). Name it: {n} completion install bash, zsh, fish, or pwsh.",
                n = shown(name),
            ),
            vec![InputProblem::Missing {
                input: InputIdentity::new(false, InputKind::Argument, "shell"),
                spelling: "shell".to_owned(),
            }],
        )
    }
}

/// The lines each child writes about its work.
pub(super) mod lines {
    use super::*;

    pub fn add_in_place(startup: &Path) -> String {
        format!("Add this line to {} in its place:", shown_path(startup))
    }

    pub fn add_yourself(name: &str, startup: &Path) -> String {
        format!(
            "{} cannot change {}, so add this line to it yourself:",
            shown(name),
            shown_path(startup)
        )
    }

    pub fn added(startup: &Path) -> String {
        format!("Added a line to {} that loads it.", shown_path(startup))
    }

    pub fn already_loads(startup: &Path) -> String {
        format!("{} already loads it.", shown_path(startup))
    }

    pub fn changed(name: &str, script: &Path) -> String {
        format!(
            "{} changed since {} completion install wrote it.",
            shown_path(script),
            shown(name)
        )
    }

    pub fn gone(script: &Path) -> String {
        format!("{} was already gone.", shown_path(script))
    }

    pub fn installed(shell: &str, script: &Path) -> String {
        format!(
            "Installed the {shell} completion script in {}.",
            shown_path(script)
        )
    }

    pub fn left_in_place(name: &str, script: &Path) -> String {
        format!(
            "{} changed since {} completion install wrote it, so it was left in place.",
            shown_path(script),
            shown(name)
        )
    }

    pub fn no_longer_holds(name: &str, startup: &Path) -> String {
        format!(
            "{} no longer holds the line {} completion install added, so it was left as it is.",
            shown_path(startup),
            shown(name)
        )
    }

    pub fn none_to_remove(name: &str) -> String {
        format!(
            "{} has no completion installed, so there is nothing to remove.",
            shown(name)
        )
    }

    pub fn none_to_update(name: &str) -> String {
        format!(
            "{n} has no completion installed, so there is nothing to update. Run {n} completion install to install it.",
            n = shown(name)
        )
    }

    pub fn not_installed(name: &str, script: &Path) -> String {
        format!(
            "{} was not installed by {} completion install.",
            shown_path(script),
            shown(name)
        )
    }

    pub const OPEN_SHELL: &str = "Open a new shell to use it.";

    pub fn remove_yourself(name: &str, startup: &Path) -> String {
        format!(
            "{} cannot change {}, so remove this line from it yourself:",
            shown(name),
            shown_path(startup)
        )
    }

    pub fn removed(path: &Path) -> String {
        format!("Removed {}.", shown_path(path))
    }

    pub fn removed_line(startup: &Path) -> String {
        format!("Removed the line from {}.", shown_path(startup))
    }

    pub fn unchanged(script: &Path) -> String {
        format!("{} is unchanged.", shown_path(script))
    }

    pub fn updated(shell: &str, script: &Path) -> String {
        format!(
            "Updated the {shell} completion script in {}.",
            shown_path(script)
        )
    }

    pub fn updated_line(startup: &Path) -> String {
        format!("Updated the line in {}.", shown_path(startup))
    }
}
