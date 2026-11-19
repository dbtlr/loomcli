---
type: adr
title: ADR-0190 - Completion installs for Nushell as one owned file in its vendor autoload folder
description: The completion plugin serves a fifth shell, Nushell, named nu. Its script is Loom's own and declares one root extern whose completer asks the application at every Tab, so Nushell's one global external completer stays the operator's. Install writes one file into the vendor autoload folder of the operator's platform, with no startup line and no edit to config.nu, recorded and removed under the owned-file rules, and Nushell 0.117 is the floor. It narrows ADR-0101's four-shell clause.
status: proposed
created: 2026-11-19
modified: 2026-11-19
---

# ADR-0190 - Completion installs for Nushell as one owned file in its vendor autoload folder

## Context

[ADR-0101](0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md) serves four shells on Linux and macOS: `bash`, `zsh`, `fish`, and `pwsh`. Nushell is a fifth shell that operators of command-line applications use, and its completion works differently from the four:

- Nushell has no completion file per command. It has one global external completer, a closure in `$env.config.completions.external.completer`, which sees every command line the shell has no declared completion for. A script that set it would take the one slot from the operator's own completer and from any other tool's.
- Nushell declares a command's completion in an `extern` signature whose parameters name a custom completer, `string@"<command>"`. An extern for a program's name takes over that program's completion and nothing else.
- Since 0.96 Nushell sources every file in its vendor autoload folders at the start of an interactive session, so a file there needs no line in `config.nu` or `env.nu`. On Linux the folder is `$XDG_DATA_HOME/nushell/vendor/autoload`, by default `~/.local/share/nushell/vendor/autoload`. On macOS, with no absolute `XDG_DATA_HOME`, it is `~/Library/Application Support/nushell/vendor/autoload`, under the platform's data folder.
- Cobra, whose scripts [ADR-0043](0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md) ports for the other four shells, has no Nushell script.

An experiment (LM-545) drove Nushell through a pseudo-terminal with a root extern whose completer called the application's `__complete` Command. It showed that the extern's completer receives the whole command line, that a record answer with `completion_algorithm: substring` shows a value that is a string, and that a completer returning `null` leaves Nushell to list file names. Nushell's own `--ide-complete` is no test of this, because it panics for a custom completer on older releases.

## Decision

- **A fifth shell, `nu`.** `completion nu` prints the script, and `install`, `update`, and `uninstall` take `nu` beside `bash`, `zsh`, `fish`, and `pwsh`. The Nushell reference is part of the [completion reference](../plugins/completion.md#nushell).
- **One root extern.** The script declares `export extern "<app>" [ ...arguments: string@"__<id>_complete" ]` for the Application's name alone. Nushell hands the completer the whole command line, and the completer asks the application at every Tab with `<app> completion __complete -- ...<words>`, so the script holds no copy of the command tree and Nushell's global external completer is left as the operator set it.
- **The script is Loom's own.** Nothing in it derives from Cobra, so it carries no Cobra notice. It speaks Cobra's `__complete` protocol and follows ADR-0043: nothing typed is evaluated, an offered word is exact or omitted, and the Application's name enters the script only as data, a double-quoted string, or encoded in function identifiers.
- **The completer reads the line itself.** It splits the line into words at white space, and a word keeps a quoted span whole, as Nushell's lexer does: a double-quoted span, which skips a backslash escape such as `\"`, a single-quoted span, a backtick string, and, at the start of a word, a raw string `r#'…'#` of any number of `#`. The span may start the word or sit in the middle of it, as in `--field="a b"` or `foo'b c'`. The word reaches the program as the characters typed without the quotes of its spans, and no escape is read or evaluated. The words go to the program in an argument list. An unclosed quote offers nothing.
- **Offered values are written so Nushell reads them back as the same text.** Nushell inserts a value exactly as the completer returns it. A bare word of letters, digits, and `_./:=+-` stays bare, so an option such as `--format=json` stays an option. Any other value is a backtick string, or, when it holds a backtick, a double-quoted string with its backslashes and quotes escaped. A record answer with `completion_algorithm: substring` makes Nushell match the word under the cursor inside such a string.
- **Directives `8` and `16` fall back to Nushell's file listing.** Their answer lines are extensions and the lead of an attached value, never values, and Nushell has no way to narrow file names by a hint, so the script returns `null` and Nushell lists file names by its own rule. Directive `4` returns an empty list in the record form, so Nushell offers no file name. A nonzero exit, an answer whose last line is not `:` and decimal digits, and the error directive `1` offer nothing and no file name.
- **Install writes one owned file.** `install nu` writes the script to `<data>/nushell/vendor/autoload/<app>.nu` and writes no startup line and no edit to `config.nu` or `env.nu`. `<data>` is an absolute `XDG_DATA_HOME` on every platform; otherwise it is `<home>/.local/share`, and on `darwin` `<home>/Library/Application Support`, the folders Nushell reads. The file is recorded in the plugin's own record, `completion.nu.json`, replaced when its content changes, left alone when it is unchanged, and removed by `uninstall`, under ADR-0101's rules for an owned file. A shell with no startup file has no line to write, print, or remove, as Fish has none.
- **The floor is Nushell 0.117.** Release binaries from 0.104 through 0.114 list file names after a completer answers with an empty list, so an unclosed quote, an error, or the no-files directive inserts a file name that was not offered. Releases 0.115 and 0.116 skip the completer for a word that looks like a flag, so no option completes. Only 0.117.0 passes every case, so older releases are not supported and the script is not written to work with them. The completer's line binds by the parameter name `buffer` on 0.117 and as the first positional parameter on older releases.
- **CI runs it.** Linux and macOS CI install one pinned Nushell release and drive the script through a pseudo-terminal.

## Considered options

- **Set the global external completer.** Rejected. It owns the one slot every other completion for a program without an extern also uses, so the script would replace the operator's completer or wrap it by reading and rewriting `config.nu`, and a second Loom application would fight the first for it.
- **Write a startup line into `config.nu`.** Rejected. The vendor autoload folder loads a file with no line, and an edit to `config.nu`, which operators keep under version control and which Nushell may write itself, would add a file Loom does not own and a mode ADR-0101's rules for startup lines exist to contain.
- **Generate a static tree of externs per Command.** Rejected. It copies the Command tree into the script, so a self-update that adds a Command leaves the script stale, and Nushell's extern signature has no form for a value computed at Tab time, which ADR-0187's completers need.

## Consequences

Operators of an application that installs the completion plugin can install Nushell completion with `<app> completion install nu`, and `update` and the self-update refresh act on it as on the other shells. The first-party documentation, the install and uninstall messages, and the `SHELL` detection list five names. On a Nushell from 0.104 through 0.114 the file offers wrong file names after an empty answer, and on 0.115 and 0.116 it offers no completion after a word that looks like a flag; neither shows an error, and 0.117 is the floor. Under a value hint for file names, Nushell lists every file name by its own rule and completes none after an `=` or a short option's attached value.

This narrows ADR-0101's **Four shells on Linux and macOS** clause, which becomes five, and the shell list in the provisions it carries forward from ADR-0078. ADR-0101 carries a dated entry. It follows ADR-0043 and ADR-0101's owned-file rules unchanged, and the operator's sentences live in the plugin's message module under [ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md).

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-19: Proposed for Nushell completion (LM-557). Review settled that macOS installs under `Library/Application Support`, which Nushell reads there, and that the floor is 0.104.
- 2026-11-19: The floor became 0.117 (LM-q77), measured on release binaries: 0.104 through 0.114 fall back to file names after an empty answer, and 0.115 and 0.116 skip the completer on flag-like words. The vendor autoload folder dates from 0.96. The completer reads a quoted span inside a word as part of the word, and a double-quoted span skips its backslash escapes.
