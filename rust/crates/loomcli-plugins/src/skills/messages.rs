//! The sentences of the skills plugin.

use std::path::Path;

use loomcli_core::{escape_control_characters, nowrap};

/// Text escaped as a failure message quotes it.
pub(super) fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// A file-system path escaped as a failure message quotes text, and kept whole when a lane wraps.
pub(super) fn shown_path(path: &Path) -> String {
    nowrap(&escape_control_characters(&path.to_string_lossy()))
}

/// The Commands that write the skills of a target.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum WritingVerb {
    /// `skills install`.
    Install,
    /// `skills update`.
    Update,
}

impl WritingVerb {
    fn word(self) -> &'static str {
        match self {
            WritingVerb::Install => "install",
            WritingVerb::Update => "update",
        }
    }
}

/// The failure of folders the record does not list that are in the way.
pub(super) fn in_the_way(name: &str, verb: WritingVerb) -> String {
    format!(
        "{name} skills {verb} changed nothing, because folders it did not install are in the way. Remove them, or run {name} skills install --force to replace them.",
        name = shown(name),
        verb = verb.word()
    )
}

/// The failure of a project folder that is the target's global folder.
pub(super) fn never_global(name: &str, folder: &Path) -> String {
    format!(
        "{name} skills install --project would write to {folder}, the folder {name} skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project.",
        name = shown(name),
        folder = shown_path(folder)
    )
}

/// The failure of a plugin's file that cannot be read.
pub(super) fn record(name: &str, record: &Path, verb: &str) -> String {
    format!(
        "{record} cannot be read, so {name} will not change the folders it lists. Remove it and the folders it lists, then run {name} skills {verb} again.",
        record = shown_path(record),
        name = shown(name)
    )
}

/// `<folder> was already gone.`
pub(super) fn gone(folder: &Path) -> String {
    format!("{} was already gone.", shown_path(folder))
}

/// `Installed <name> for <target> in <folder>.`
pub(super) fn installed(name: &str, target: &str, folder: &Path) -> String {
    format!(
        "Installed {} for {target} in {}.",
        shown(name),
        shown_path(folder)
    )
}

/// `Installed <name> for <target> in <folder>, replacing the copy that was there.`
pub(super) fn installed_over(name: &str, target: &str, folder: &Path) -> String {
    format!(
        "Installed {} for {target} in {}, replacing the copy that was there.",
        shown(name),
        shown_path(folder)
    )
}

/// The line of an uninstall with nothing recorded.
pub(super) fn none_to_remove(name: &str) -> String {
    format!(
        "{} has no skills installed in your home folder, so there is nothing to remove.",
        shown(name)
    )
}

/// The line of an update with nothing recorded.
pub(super) fn none_to_update(name: &str) -> String {
    format!(
        "{name} has no skills installed in your home folder, so there is nothing to update. Run {name} skills install to install them.",
        name = shown(name)
    )
}

/// The warning of a folder the record does not list.
pub(super) fn not_installed(name: &str, folder: &Path) -> String {
    format!(
        "{} was not installed by {} skills install.",
        shown_path(folder),
        shown(name)
    )
}

/// `Removed <folder>.`
pub(super) fn removed(folder: &Path) -> String {
    format!("Removed {}.", shown_path(folder))
}

/// The line of a folder the force mode replaced.
pub(super) fn replaced(name: &str, folder: &Path) -> String {
    format!(
        "Replaced {}, which {} skills install did not install.",
        shown_path(folder),
        shown(name)
    )
}

/// The line of two skills directories that are one folder.
pub(super) fn same_folder(name: &str, agents: &Path, claude: &Path) -> String {
    format!(
        "{} is the same folder as {}, so {} acts on it once, for claude.",
        shown_path(agents),
        shown_path(claude),
        shown(name)
    )
}

/// `<folder> is unchanged.`
pub(super) fn unchanged(folder: &Path) -> String {
    format!("{} is unchanged.", shown_path(folder))
}

/// `Updated <name> for <target> in <folder>.`
pub(super) fn updated(name: &str, target: &str, folder: &Path) -> String {
    format!(
        "Updated {} for {target} in {}.",
        shown(name),
        shown_path(folder)
    )
}

/// The stderr line of a refresh whose binary could not start, ending with a line feed.
pub(super) fn skills_not_refreshed(path: &str, name: &str) -> String {
    format!(
        "The skills were not refreshed because {} could not start. Run {} skills update.\n",
        shown(path),
        shown(name)
    )
}

/// The `warn` log event of a refresh whose child failed or could not start.
pub(super) const SKILLS_REFRESH_FAILED: &str = "Skills were not refreshed after the update.";
