//! Whether man finds the installed pages, read from `MANPATH` and `PATH`, and the line that sets
//! `MANPATH` for an operator whose man will not. The plugin never edits a startup file.

use std::path::{Path, PathBuf};

use loomcli_core::Env;

use super::children::resolve;

/// The folder `man` searches, the parent of the pages' `man1`, and the line that adds it.
pub(super) struct Advice {
    pub(super) folder: PathBuf,
    pub(super) line: String,
}

/// An entry with one trailing `/` removed, unless the entry is the root alone.
fn without_slash(entry: &str) -> &str {
    if entry == "/" {
        entry
    } else {
        entry.strip_suffix('/').unwrap_or(entry)
    }
}

/// Whether an entry of `PATH` maps to the folder: `<home>/.local/bin`, with a trailing `/` removed.
fn path_maps(home: &Path, path: Option<&str>) -> bool {
    let bin = resolve(home, ".local/bin");
    let bin = bin.to_string_lossy();
    path.unwrap_or("")
        .split(':')
        .any(|entry| without_slash(entry) == bin)
}

/// Whether `man` finds `<home>/.local/share/man`: with `MANPATH` unset or empty and `PATH` mapping
/// to it, with `MANPATH` listing it, or with `MANPATH` holding an empty entry, which both `man`
/// programs read as their default search, and `PATH` mapping to it.
fn man_finds(home: &Path, env: &Env) -> bool {
    let folder = man_folder(home);
    let folder = folder.to_string_lossy();
    let maps = path_maps(home, env.get("PATH").map(String::as_str));
    let manpath = env.get("MANPATH").map(String::as_str).unwrap_or("");
    if manpath.is_empty() {
        return maps;
    }
    let mut entries = manpath.split(':');
    if entries.clone().any(|entry| without_slash(entry) == folder) {
        return true;
    }
    entries.any(str::is_empty) && maps
}

/// The folder `man` searches under a home: `<home>/.local/share/man`.
fn man_folder(home: &Path) -> PathBuf {
    resolve(home, ".local/share/man")
}

/// The folder in double quotes, with each `"`, `\`, `$`, and backtick escaped with a `\`.
fn double_quoted(folder: &str) -> String {
    let mut quoted = String::with_capacity(folder.len());
    for character in folder.chars() {
        if matches!(character, '"' | '$' | '\\' | '`') {
            quoted.push('\\');
        }
        quoted.push(character);
    }
    quoted
}

/// The folder as a Fish single-quoted string, which reads `\\` and `\'` as escapes.
fn fish_quoted(folder: &str) -> String {
    format!("'{}'", folder.replace('\\', "\\\\").replace('\'', "\\'"))
}

/// Whether the login shell is Fish: the last segment of `SHELL`, after the last `/` or `\`.
fn is_fish(shell: Option<&str>) -> bool {
    shell
        .unwrap_or("")
        .rsplit(['/', '\\'])
        .next()
        .is_some_and(|last| last == "fish")
}

/// The advice for an install, or none when `man` finds the pages: the folder, and the line that
/// puts it first on `MANPATH`, leaving a trailing colon when `MANPATH` was unset so the default
/// search still follows.
pub(super) fn advice(home: &Path, env: &Env) -> Option<Advice> {
    if man_finds(home, env) {
        return None;
    }
    let folder = man_folder(home);
    let text = folder.to_string_lossy();
    let line = if is_fish(env.get("SHELL").map(String::as_str)) {
        format!("set -gx MANPATH {} \"$MANPATH\"", fish_quoted(&text))
    } else {
        format!("export MANPATH=\"{}:${{MANPATH-}}\"", double_quoted(&text))
    };
    Some(Advice { folder, line })
}
