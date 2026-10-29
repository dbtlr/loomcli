---
type: adr
title: ADR-0119 - The configuration lookup walks to home, reads an author-named variable and the XDG user file, and never falls back after a broken file
description: Without --config, the configuration plugin reads the file an author-named variable names, or else the first file found by a walk from the start directory up to the home directory, or to the root outside home, then the home file, then the XDG user file. A discovered file that is broken warns once and the run has no configuration; no later location answers. A missing file is silent, and an author setting turns on a notice when nothing is found. An opt-in global option moves where the walk starts without changing host.cwd. This supersedes ADR-0054's lookup in the working directory and then the home directory, its fallback past a broken file, and its rejection of a per-user XDG file.
status: proposed
created: 2026-10-28
modified: 2026-10-28
---

# ADR-0119 - The configuration lookup walks to home, reads an author-named variable and the XDG user file, and never falls back after a broken file

## Context

[ADR-0054](0054-the-configuration-plugin-reads-one-file-per-run-found-by-the-authors-file-pattern.md) reads one file per run: the file `--config` names, or else the author's `file` in the working directory and then in the home directory. A broken file in the working directory is skipped and the home file answers in its place. It left an ancestor walk and a variable for `--config` out, and rejected a per-user file under `XDG_CONFIG_HOME`.

Heimdall's applications run from any directory of a project and keep a user file under `~/.config`, so they re-implement the lookup. An operator in `src/` of a project finds no project file, because the plugin looks only where the operator stands. The fallback past a broken file can hand a run another file's account or endpoint while the operator edits the first.

The owner set the method: "This is not a space we're innovating in, so we are not inventing rules, we're just looking to best practices." Two researchers read the documentation and source of cosmiconfig, lilconfig, c12, ESLint, Prettier, Biome, tsc, npm, EditorConfig, git, Cargo, Ruff, uv, starship, gh, Viper, the Docker CLI, and the XDG specification (LM-269):

- **Walk.** ESLint, Prettier, Biome, tsc, EditorConfig, Cargo, Ruff, and uv walk to the filesystem root. lilconfig and cosmiconfig's `global` strategy stop at a directory that defaults to home. starship, gh, Viper, and Docker do not walk.
- **A broken discovered file.** git, Cargo, Ruff, gh, Viper, uv, cosmiconfig, lilconfig, ESLint, Prettier, Biome, and tsc fail. starship and Docker warn and use defaults. None falls back to a later file after a parse failure, except uv for a `pyproject.toml` that may not be its own.
- **A named file.** Ruff, Cargo, uv, Viper, ESLint, Prettier, Biome, and tsc fail when it is missing; starship, gh, Docker, and npm use defaults. uv, starship, Biome, and git read a variable that names the file.
- **A user level.** git, uv, Ruff, gh, Biome, and starship read an XDG directory. Two of the eighteen read a system level.

## Decision

- **One file, the first found.** A run reads at most one file, and nothing merges, as ADR-0054 holds. The plugin tries these in order and stops at the first that yields a file:
  1. **`--config <file>`.** That file alone, strict, as ADR-0054 states: missing or broken fails the run with code 2.
  2. **The author-named variable.** `configuration({ env })` names a variable the plugin reads from `host.env`. When it holds a nonempty value, that file alone is the configuration, with no search. A relative value resolves against `host.cwd`, and the value is not a pattern, so its extension chooses its parser as `--config`'s does. A missing file is silent and the run has no configuration. A broken file warns once and the run has no configuration. An empty or unset variable is skipped, as an empty variable is unset under [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md).
  3. **The walk.** The plugin looks for `file` in the start directory and then in each ancestor, up to and including the home directory when the start directory is the home directory or inside it, and up to the filesystem root otherwise. The start directory is the directory option's value when the author declares one and the operator gives it, and `host.cwd` otherwise. Paths compare lexically, as `node:path` resolves them, and a file that is a symbolic link is read through it. A run with no home directory walks to the root.
  4. **The home file.** `file` in the home directory, `host.home`, when the walk did not look there.
  5. **The XDG user file.** `$XDG_CONFIG_HOME/<app>/config.<ext>`, or `<home>/.config/<app>/config.<ext>` when `XDG_CONFIG_HOME` is unset, empty, or a relative path, where `<app>` is the application name, `graph.name`. Each of the pattern's candidates names one extension in candidate order: its own when it is `json`, `toml`, `yaml`, or `yml`, and `json` otherwise, because such a name reads as JSON. An extension named twice counts once. With neither `XDG_CONFIG_HOME` nor a home directory there is no user file.
- **No fallback after a broken file.** A file the variable names or the lookup discovers that cannot be read, does not parse, or does not hold an object warns once in its fixed sentence, and the run has no configuration: no later location answers in its place. The sentence says so: `Skipped <file>: the file is not valid TOML, so this run reads no configuration. Correct its syntax, or remove it.`, and the same for every other fault ADR-0054 names.
- **Missing is silent.** A location that holds no file prints nothing. With `configuration({ notice: true })`, a run whose lookup finds no file writes one `out.info` line naming the first place the operator could create one. The notice is off by default.
- **No system level.** The plugin reads no `/etc` or other machine-wide file. The owner: "Leave out system."
- **The directory option.** `configuration({ directory: { name, short } })` makes the plugin declare a global string option, `--<name>`, whose value replaces `host.cwd` as the walk's start directory. It does not change `host.cwd`. The action reads it like any plugin option, so an application that takes a project directory uses one option for its own work and for the lookup. A relative value resolves against `host.cwd`. The plugin judges nothing about the directory: one that does not exist starts the walk there, and the walk goes on through its ancestors. `--config` and the variable still come first. The option is global because the provider of [ADR-0118](0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) reads global options alone. It binds no variable in this release.
- **Labels.** A file found in `host.cwd` shows as `file` names it, with a pattern's extension replaced by the candidate's. A file found anywhere else in the lookup shows as its full path. The `--config` file and the variable's file show as the operator wrote them.

These rules of ADR-0054 stand: the file pattern and its candidates, the several-candidates warning, the parsers, what a YAML file holds, the top level, the named file strict, fixed and escaped text, and the faults `configuration()` judges at its call for `file` and `short`.

## Considered options

- **Walk to the filesystem root, as most surveyed tools do.** Rejected. The owner asked for a bound, and lilconfig and cosmiconfig's `global` strategy bound at home. A directory above home belongs to another account or to the machine.
- **Fall back to the next location after a broken file, as ADR-0054 does.** Rejected. No surveyed tool falls back after a parse failure, and a fallback can run a command against another file's account while the operator edits the first.
- **Fail the run on a broken discovered file, as most surveyed tools do.** Rejected by the owner: "An unreadable or broken config should NEVER break the build for an operator. It should at most trigger a warning for them." starship and Docker warn and use defaults.
- **The variable as an environment binding on `--config`.** Rejected. A variable persists across every command, so a strict missing file would fail every run, including the command that would create the file. starship treats `STARSHIP_CONFIG` the same way.
- **A system level.** Rejected. Two of eighteen tools have one, and the owner left it out.
- **A directory option that changes `host.cwd`.** Rejected. The owner: "It doesn't need to change the host's cwd, it just needs to use the option instead." Every path an action resolves would move with it.
- **`%APPDATA%` for the user file on Windows.** Not added. No CI job runs Windows, under [ADR-0100](0100-acceptance-plans-live-beside-the-tests.md), which removed the plugin's Windows home for the same reason.

## Consequences

The walk reads more directories, each through one `stat` per candidate, so a run started deep in a tree pays a few more system calls before it reads a file. A broken file in the working directory no longer lets the home file answer, which an operator who relied on that sees as a run with no configuration and a warning that says so. Both are changes for the implementation's fragments. Follow-ups wait for this lookup: LM-375 adds the line and column to the broken-file warning, and LM-378 adds `--no-config`. [Configuration plugin](../plugins/config.md) carries the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships the lookup: the variable, the walk, the home file, the XDG user file, no fallback after a broken file, the notice, and the directory option.

## Changelog

- 2026-10-28: Proposed with the configuration contract (LM-426). It supersedes ADR-0054's lookup in the working directory and then the home directory, its clause that a broken discovered file is absent so the lookup goes on, and its rejection of a per-user XDG file. ADR-0054 carries a dated entry.
