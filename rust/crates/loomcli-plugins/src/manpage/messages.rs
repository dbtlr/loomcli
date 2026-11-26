//! The sentences of the man page plugin.

use std::path::Path;

use loomcli_core::{escape_control_characters, nowrap};

/// Text escaped as a failure message quotes it.
fn shown(text: &str) -> String {
    escape_control_characters(text)
}

/// A file-system path escaped as a failure message quotes text, and kept whole when a lane wraps.
pub(super) fn shown_path(path: &Path) -> String {
    nowrap(&escape_control_characters(&path.to_string_lossy()))
}

/// `1 man page`, or the count and `man pages` for every other count.
fn pages(count: usize) -> String {
    if count == 1 {
        "1 man page".to_owned()
    } else {
        format!("{count} man pages")
    }
}

/// The Commands that write the pages, which a sentence names.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum WritingVerb {
    Install,
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

/// Files that were not installed by the plugin are in the way.
pub(super) fn in_the_way(name: &str, verb: WritingVerb) -> String {
    format!(
        "{name} manpage {verb} changed nothing, because files it did not install are in the way. Remove them, then run {name} manpage install again.",
        name = shown(name),
        verb = verb.word()
    )
}

/// A record that lists pages in more than one folder.
pub(super) fn many_folders(name: &str, record: &Path) -> String {
    format!(
        "{record} lists man pages in more than one folder, so {name} manpage update cannot tell where they belong. Run {name} manpage install to put them in one folder.",
        record = shown_path(record),
        name = shown(name)
    )
}

/// A `--out` that names anything but a folder.
pub(super) fn not_folder(name: &str, folder: &Path) -> String {
    format!(
        "{folder} is not a folder. Name a folder, or a path where {name} can create one.",
        folder = shown_path(folder),
        name = shown(name)
    )
}

/// The plugin's file cannot be read.
pub(super) fn record(name: &str, record: &Path, verb: &str) -> String {
    format!(
        "{record} cannot be read, so {name} will not change the man pages it lists. Remove it and the pages it lists, then run {name} manpage {verb} again.",
        record = shown_path(record),
        name = shown(name)
    )
}

/// The advice line that leads the `MANPATH` export.
pub(super) fn advice(folder: &Path) -> String {
    format!(
        "man will not find these pages until MANPATH lists {}. Add this line to your shell's startup file:",
        shown_path(folder)
    )
}

/// A recorded page whose digest changed since the install wrote it.
pub(super) fn changed(name: &str, file: &Path) -> String {
    format!(
        "{} changed since {} manpage install wrote it.",
        shown_path(file),
        shown(name)
    )
}

/// `Installed <count> man pages in <folder>.`
pub(super) fn installed(count: usize, folder: &Path) -> String {
    format!("Installed {} in {}.", pages(count), shown_path(folder))
}

/// A recorded page the set no longer holds, kept because it changed.
pub(super) fn kept(name: &str, file: &Path) -> String {
    format!(
        "{} changed since {} manpage install wrote it, so it was left in place.",
        shown_path(file),
        shown(name)
    )
}

pub(super) fn none_to_remove(name: &str) -> String {
    format!(
        "{} has no man pages installed, so there is nothing to remove.",
        shown(name)
    )
}

pub(super) fn none_to_update(name: &str) -> String {
    format!(
        "{name} has no man pages installed, so there is nothing to update. Run {name} manpage install to install them.",
        name = shown(name)
    )
}

/// A file at a page's path that the record does not list.
pub(super) fn not_installed(name: &str, file: &Path) -> String {
    format!(
        "{} was not installed by {} manpage install.",
        shown_path(file),
        shown(name)
    )
}

pub(super) fn read(name: &str) -> String {
    format!("Read them with man {}.", shown(name))
}

pub(super) fn removed(file: &Path) -> String {
    format!("Removed {}.", shown_path(file))
}

pub(super) fn removed_from(count: usize, folder: &Path) -> String {
    format!("Removed {} from {}.", pages(count), shown_path(folder))
}

pub(super) fn unchanged(count: usize, folder: &Path) -> String {
    format!(
        "The {} in {} {} unchanged.",
        pages(count),
        shown_path(folder),
        if count == 1 { "is" } else { "are" }
    )
}

pub(super) fn updated(count: usize, folder: &Path) -> String {
    format!("Updated {} in {}.", pages(count), shown_path(folder))
}

pub(super) fn wrote(count: usize, folder: &Path) -> String {
    format!("Wrote {} to {}.", pages(count), shown_path(folder))
}

/// The stderr line of a refresh whose binary could not start, ending with a line feed.
pub(super) fn man_pages_not_refreshed(path: &str, name: &str) -> String {
    format!(
        "The man pages were not refreshed because {} could not start. Run {} manpage update.\n",
        shown(path),
        shown(name)
    )
}

/// The `warn` log event of a refresh whose child failed or could not start.
pub(super) const MAN_PAGES_REFRESH_FAILED: &str = "Man pages were not refreshed after the update.";

/// The failure of a `generate` run without `--out`, which validation rejects first.
pub(super) const OUT_REQUIRED: &str = "--out is required.";
