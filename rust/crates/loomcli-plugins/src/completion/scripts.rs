//! The four completion scripts, ported from Cobra's `bash_completionsV2.go`, `zsh_completions.go`,
//! `fish_completions.go`, and `powershell_completions.go` (Copyright 2013-2023 The Cobra Authors,
//! Apache License, Version 2.0; see `licenses/`). Each lives in `templates/` as the reference's
//! script text with the parts derived from the application name left as placeholders, so the
//! script is the reference's character for character.
//!
//! The changes from Cobra, which the templates carry and `licenses/NOTICE` states:
//!
//! - Every `eval` is removed: the program is called with an argument array, and no answer runs as
//!   source, so pressing Tab never runs a typed word.
//! - The application name enters a script only as data: single-quoted in the shell's own quoting,
//!   or encoded into function identifiers by [`identifier`], and only the Application's portable
//!   name.
//! - ActiveHelp handling is removed. The request carries every word, the last cut at the cursor.
//!   A nonzero exit, or an answer whose last line is not `:` and decimal digits, offers nothing.
//! - Each shell removes quoting from a word without evaluating it, and an unclosed quote under the
//!   cursor offers nothing without a call.

use super::name::{fish_quoted, identifier, posix_quoted, powershell_quoted};

const BASH: &str = include_str!("templates/bash.sh");
const ZSH: &str = include_str!("templates/zsh.zsh");
const FISH: &str = include_str!("templates/fish.fish");
const POWERSHELL: &str = include_str!("templates/powershell.ps1");

/// The Bash script printed by `completion bash`, for the application `name`.
#[must_use]
pub fn bash_script(name: &str) -> String {
    BASH.replace("@@ID@@", &identifier(name))
        .replace("@@QUOTED@@", &posix_quoted(name))
}

/// What differs between the Zsh script printed and the Zsh file installed: the guard lines after
/// the `#compdef` line, and the function name the file is autoloaded as.
fn zsh_text(name: &str, guard: &str, loaded_as: &str) -> String {
    ZSH.replace("@@ID@@", &identifier(name))
        .replace("@@QUOTED@@", &posix_quoted(name))
        .replace("@@GUARD@@", guard)
        .replace("@@LOADED_AS@@", loaded_as)
        .replace("@@NAME@@", name)
}

/// The Zsh script printed by `completion zsh`. The `#compdef` line and the autoload check carry
/// the name as it is, because the Application's name is a portable name.
#[must_use]
pub fn zsh_script(name: &str) -> String {
    zsh_text(name, "", &format!("_{name}"))
}

/// The Zsh file `completion install` writes, named `_loom_<identifier>`: the printed script with
/// its autoload check naming that file, and, right after the `#compdef` line, a guard that starts
/// the completion system when `.zshrc` has not, with `compinit -i`, which skips an insecure folder
/// on `fpath` rather than asking, and registers nothing when `compdef` is still not defined.
#[must_use]
pub fn zsh_installed_script(name: &str) -> String {
    let guard = "# Start the completion system when no compdef is defined, and register nothing without it.\n(( $+functions[compdef] )) || { autoload -Uz compinit && compinit -i }\n(( $+functions[compdef] )) || return 0\n";
    zsh_text(name, guard, &format!("_loom_{}", identifier(name)))
}

/// The Fish script printed by `completion fish`.
#[must_use]
pub fn fish_script(name: &str) -> String {
    FISH.replace("@@ID@@", &identifier(name))
        .replace("@@QUOTED@@", &fish_quoted(name))
        .replace("@@SPACED@@", &fish_quoted(&format!("{name} ")))
}

/// The PowerShell script printed by `completion powershell`.
#[must_use]
pub fn powershell_script(name: &str) -> String {
    POWERSHELL
        .replace("@@ID@@", &identifier(name))
        .replace("@@QUOTED@@", &powershell_quoted(name))
}
