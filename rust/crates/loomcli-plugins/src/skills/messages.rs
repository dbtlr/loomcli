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
        "{name} skills {verb} changed nothing, because folders it did not install, or whose command references changed since it installed them, are in the way. Copy any file you want to keep out of them, then remove them or run {name} skills install --force to replace them.",
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

pub(super) const SKILLS_REFRESH_SKIPPED: &str = "Skipped the skills refresh: nothing is installed.";

pub(super) const DIRECTORY_WITHOUT_PROJECT_ISSUE: &str = "Add --project, or leave out --directory.";

pub(super) const DIRECTORY_WITHOUT_PROJECT: &str =
    "Option \"--directory\" needs --project. Add --project, or leave out --directory.";

pub(super) const DIRECTORY_MISSING_ISSUE: &str = "Name a directory that exists.";

pub(super) fn directory_missing(start: &str) -> String {
    format!(
        "Option \"--directory\" names {}, which is not a directory. Name a directory that exists.",
        shown(start)
    )
}

pub(super) fn reference_changed(name: &str, file: &Path) -> String {
    format!(
        "{} changed since {} skills install wrote it.",
        shown_path(file),
        shown(name)
    )
}

pub(super) fn replaced_modified(name: &str, folder: &Path) -> String {
    format!(
        "Replaced {}, whose command references changed since {} skills install wrote them.",
        shown_path(folder),
        shown(name)
    )
}

pub(super) fn modified_kept(name: &str, folder: &Path) -> String {
    format!(
        "{} was left in place, because command references in it changed since {} skills install wrote them. Copy what you want to keep, then remove the folder.",
        shown_path(folder),
        shown(name)
    )
}

pub(super) fn status_same_folder(name: &str, agents: &Path, claude: &Path) -> String {
    format!(
        "{} is the same folder as {}, so {} reports on it once, for claude.",
        shown_path(agents),
        shown_path(claude),
        shown(name)
    )
}

pub(super) fn status_record(name: &str, path: &Path) -> String {
    let name = shown(name);
    let path = shown_path(path);
    format!(
        "{path} cannot be read, so {name} cannot tell which skills it installed. Remove it and the folders it lists, then run {name} skills install again."
    )
}

pub(super) fn status_project_global(name: &str, folder: &Path) -> String {
    let name = shown(name);
    let folder = shown_path(folder);
    format!(
        "{name} skills status --project would read {folder}, the folder {name} skills install keeps for your home folder. Run it inside a repository, name one with --directory, or leave out --project."
    )
}

pub(super) fn obsolete_skill(name: &str, folder: &Path, modified: bool) -> String {
    let name = shown(name);
    let folder = shown_path(folder);
    if modified {
        format!(
            "{name} skills install recorded {folder}, a skill this version no longer declares, and command references in it changed, so {name} skills update will leave it in place. Copy what you want to keep, then remove the folder."
        )
    } else {
        format!(
            "{name} skills install recorded {folder}, a skill this version no longer declares. Run {name} skills update to remove it, once no skill reads modified or unmanaged."
        )
    }
}

use super::status::State;

fn directory_word(root: &Path) -> String {
    let root = root.to_string_lossy();
    if root
        .bytes()
        .all(|byte| byte.is_ascii_alphanumeric() || b"_./:-".contains(&byte))
    {
        shown(&root)
    } else {
        shown(&format!("'{}'", root.replace('\'', r"'\''")))
    }
}

pub(super) fn global_status_note(name: &str, target: &str, state: State) -> Option<String> {
    let name = shown(name);
    let target = shown(target);
    let install = format!("{name} skills install --agent {target}");
    Some(match state {
        State::Missing => {
            format!("Run {install} to install it, once no skill reads modified or unmanaged.")
        }
        State::Unmanaged => format!(
            "The installation record does not list what is at this path. Remove it, or run {install} --force to replace it."
        ),
        State::Modified => format!(
            "Its command references changed since {name} skills install wrote them, so {name} skills update will not replace it. Copy the changed files elsewhere to keep them, then run {install} --force to replace the folder."
        ),
        State::Stale => format!(
            "Run {name} skills update to bring it up to date, once no skill reads modified or unmanaged."
        ),
        State::Current => return None,
    })
}

pub(super) fn project_status_note(
    name: &str,
    target: &str,
    root: Option<&Path>,
    state: State,
) -> Option<String> {
    let name = shown(name);
    let target = shown(target);
    let mut install = format!("{name} skills install --project --agent {target}");
    if let Some(root) = root {
        install.push_str(" --directory ");
        install.push_str(&directory_word(root));
    }
    Some(match state {
        State::Missing => format!("Run {install} to install it."),
        State::Unmanaged => format!(
            "{name} skills install --project did not write this, because it is not a folder. Run {install} to replace it."
        ),
        State::Modified | State::Stale => {
            format!("Run {install} to replace it with this version's.")
        }
        State::Current => return None,
    })
}

pub(super) fn unknown_command_path(skill: Option<&str>, path: &[String]) -> (String, &'static str) {
    let names: Vec<_> = path
        .iter()
        .map(|name| serde_json::Value::String(name.clone()).to_string())
        .collect();
    let path = shown(&format!("[{}]", names.join(", ")));
    let sentence = skill.map_or_else(
        || format!("The path {path} names no Command."),
        |skill| {
            format!(
                "Skill \"{}\" selects the path {path}, which names no Command.",
                shown(skill)
            )
        },
    );
    (
        sentence,
        "Name each Command on the path from the root down, such as [\"note\", \"add\"], or select [] for the whole application.",
    )
}

pub(super) fn reference_name_taken(
    skill: Option<&str>,
    earlier: &str,
    later: &str,
    file: &str,
) -> (String, &'static str) {
    let commands = format!("Commands \"{}\" and \"{}\"", shown(earlier), shown(later));
    let file = shown(file);
    match skill {
        None => (
            format!("{commands} both give the file {file}."),
            "Rename one of them, or hide one.",
        ),
        Some(skill) => (
            format!(
                "Skill \"{}\" selects {commands}, which both give the file references/commands/{file}.",
                shown(skill)
            ),
            "Rename one of them, hide one, or select one of them alone.",
        ),
    }
}

pub(super) fn root_is_index(skill: Option<&str>, application: &str) -> (String, &'static str) {
    let name = shown(application);
    match skill {
        None => (
            format!("The root of {name} gives the file index.md, which is the name of the index."),
            "Rename the application.",
        ),
        Some(skill) => (
            format!(
                "Skill \"{}\" selects the root of {name}, whose file references/commands/index.md is the name of the index.",
                shown(skill)
            ),
            "Select the root's Commands by their own paths, such as [\"get\"], in place of [].",
        ),
    }
}

pub(super) fn reference_aliases(aliases: &[String], heading: bool) -> String {
    let label = match (aliases.len() == 1, heading) {
        (true, true) => "Alias",
        (true, false) => "alias",
        (false, true) => "Aliases",
        (false, false) => "aliases",
    };
    format!("{label}: {}", shown(&aliases.join(", ")))
}

pub(super) const SKILL_FILE_LEFT_OUT: &str = "Left out {path}, which the skill {skill} supplies, because the plugin owns that name for its command references.";

pub(super) fn selected_skill_missing(folder: &Path, name: &str) -> (String, String) {
    let name = shown(name);
    let folder = shown(&folder.to_string_lossy());
    (
        format!(
            "The skills setting lists the skill {name} without files, and the skills folder {folder} holds no skill {name}."
        ),
        format!(
            "Add a folder named {name}, holding its SKILL.md, to the skills folder, or give the entry its files."
        ),
    )
}
