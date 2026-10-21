---
type: adr
title: ADR-0101 - Completion installs on Linux and macOS, and a startup line is written or printed
description: The completion plugin's install, update, and uninstall serve bash, zsh, fish, and pwsh on Linux and macOS, and refuse on Windows, where completion powershell still prints Cobra's script. Windows PowerShell 5.1 as its own shell, the execution-policy check, UTF-16LE startup files, the byte order mark on a created profile, and the win32 variables and folders come out. A startup line is either written and recorded, or printed with nothing recorded, and uninstall removes only a line Loom wrote. Every other provision of ADR-0078 carries forward. It supersedes ADR-0078.
status: proposed
created: 2026-10-20
modified: 2026-10-21
---

# ADR-0101 - Completion installs on Linux and macOS, and a startup line is written or printed

## Context

[ADR-0078](0078-the-completion-plugin-installs-a-script-and-one-startup-line-per-shell.md) gives the completion plugin `install`, `update`, and `uninstall` for five shells, two of them PowerShell editions, and a startup line in the operator's startup file for every shell but Fish. Its Windows rows are a set of their own:

- Windows PowerShell 5.1 as the shell `powershell`, with its own record file and program lookup;
- shell detection from `PSModulePath` when `SHELL` is unset;
- the `LOCALAPPDATA` data folder, `USERPROFILE` as home, and a startup line that names the script through `$env:LOCALAPPDATA`;
- a program lookup with `.exe` and `PATH` read without case;
- the execution-policy check;
- reading and writing UTF-16LE startup files;
- a byte order mark on a profile the plugin creates.

ADR-0078's Consequences already state that these rows are unverified, because no CI runner has Windows. They run only under a faked platform in unit tests. [ADR-0100](0100-acceptance-plans-live-beside-the-tests.md) takes such code out until a CI entry runs it.

The startup-line rules also grew three modes beside writing a line. A plugin may release a recorded line from a file it cannot change, keep a recorded line unread in a file it cannot read, and hold a line the operator added by hand after an earlier notice, recording it without writing the file. The keep and hold modes cover an operator who later pastes the printed line, or whose file later becomes unreadable. Each is a refinement no plausible run needs, and each adds a mode to the installed-files module and its tests.

## Decision

- **Four shells on Linux and macOS.** `install`, `update`, and `uninstall` serve `bash`, `zsh`, `fish`, and `pwsh`. `pwsh` is PowerShell 7, whose startup file is the `$PROFILE` it reports.
- **Windows refuses.** On `win32`, `install`, `update`, and `uninstall` fail with a `FatalError` and exit 1 that names the print Command, so an operator prints the script and loads it by hand. `completion powershell` still prints the PowerShell script ported from Cobra, and the other print children still print theirs.
- **What comes out.** `powershell` as a shell `install` and `uninstall` name, its record file, and its program lookup; shell detection from `PSModulePath`; `LOCALAPPDATA`, `USERPROFILE`, and the `$env:LOCALAPPDATA` startup line; the `.exe` lookup and the case-insensitive `PATH` read; the execution-policy check and its message; UTF-16LE startup files; and the byte order mark on a created profile. The installed-files module reads a startup file as UTF-8, with or without its byte order mark, and a file in any other encoding is one the plugin cannot change.
- **A startup line is written or printed.** When the plugin may change a startup file, it writes the line and records it. When it may not, it writes the script, prints the line for the operator, and records no line, dropping any line the record held for that file without writing the file. The keep and hold modes go.
- **Uninstall removes only a line Loom wrote.** `uninstall` removes a recorded line from a file it may change. For a recorded line in a file it may not change, it prints the line for the operator to remove and drops it from the record. A line the operator added by hand is not recorded, so uninstall never removes it.

This record supersedes ADR-0078 whole. Every other provision of ADR-0078 is incorporated by reference, with its addenda:

- `completion` keeps its print children, and `install [shell]` and `uninstall [shell]` take the shell as an argument, with `install` defaulting to the last segment of `SHELL`;
- install writes the script under `<data>/<app>/completion/` and adds one startup line that loads it when it exists, for Bash and Zsh and PowerShell 7, while Fish's script goes to `~/.config/fish/completions` with no line;
- the Zsh line puts the script's folder on `fpath`, and the file is named `_loom_<identifier>`;
- the startup files are Zsh's `.zshrc` under an absolute `ZDOTDIR` or home, Bash's `.bashrc` and on macOS the first login file that exists, and PowerShell 7's `$PROFILE`, which install asks `pwsh` for by running it once from home, found only in absolute `PATH` entries, with its answer in Base64;
- the line is exact, added once at the end of the file, and found by equality;
- startup lines are recorded through the installation record, narrowing [ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md)'s rule for startup lines alone, appended in place and replaced or removed through a staging file and a rename;
- one record file per shell, with script files under ADR-0071 as written and no `--force`;
- a startup file that is not a file fails install;
- the PowerShell script follows [ADR-0043](0043-shell-completion-follows-cobras-protocol-and-never-evaluates-typed-text.md), with no `Invoke-Expression`, every PowerShell single quote doubled, and no `.bat` or `.cmd` program called;
- `update` rewrites what the record lists, and `refreshCompletion` refreshes after a self-update;
- the rejected options other than "PowerShell 7 alone".

ADR-0078 took the shell as an argument because a Command path nested at most two levels. [ADR-0094](0094-core-sets-no-structural-limit-and-a-projection-reports-its-own-limits.md) removes that cap, and the shape stays.

## Considered options

- **Keep the Windows rows as unverified support.** Rejected. Code no CI runs fails nowhere when it breaks, and the support statement already leaves Windows out.
- **Keep the hold mode so uninstall remembers a pasted line.** Rejected. It records a line Loom never wrote, and an operator who pasted the line removes it the way they added it.

## Consequences

A Linux or macOS operator sees the same install, update, and uninstall, except that `powershell` is no longer an install shell name and a line the operator pasted after a notice is no longer recorded. A Windows operator gets a refusal from `completion install` and loads the printed script by hand. The change is breaking for an application whose operators installed `powershell` completion on Windows, and the implementing PR's fragment states the migration.

## Status

Proposed. It moves to accepted with the release that removes the Windows install paths and the keep and hold modes, planned for 0.15.0.

## Changelog

- 2026-10-20: Proposed with the 0.15.0 rescope.
- 2026-10-21: The implementation settles two cases the Decision leaves open. A startup file the plugin may not change that already holds the line gets no line printed: `install` states that the file already loads the script, and records no line. `update` drops a recorded line whose text this version keeps without printing anything, because no line in the file has to change, and prints the line to remove and the line to add in its place when the text changes.
