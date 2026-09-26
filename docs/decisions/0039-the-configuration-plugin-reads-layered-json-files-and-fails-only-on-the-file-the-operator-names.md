---
type: adr
title: ADR-0039 - The configuration plugin reads layered JSON files and fails only on the file the operator names
description: The first-party configuration plugin answers the configuration tier from a user file derived from the application name and the project files the application lists, combined key by key with the first listed file winning. `--config` replaces every file for one run. A file the plugin discovered never breaks a run; a file the operator named, and a wrong value in any file, is a usage failure.
status: proposed
created: 2026-09-26
modified: 2026-09-26
---

# ADR-0039 - The configuration plugin reads layered JSON files and fails only on the file the operator names

## Context

[ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) gave core a configuration tier with one source and left the store, the file format, and the path grammar to the plugin that declares it. The purpose of the tier is that an operator sets a value once, for a machine or for a project, instead of typing it on every run. The plugin has to decide where the files are, how several combine, how the operator overrides them, and which broken file stops a run.

An author climbs the plugin in rungs. Installing it and binding one option makes a user file work, with no path named. Listing project files adds files that win over the user file. The operator's `--config` then pins one file for one run. The value shapes follow the option's raw type.

## Decision

- **The user file.** The plugin derives one user file from the application name, reading `host.platform` and `host.env` alone. On Windows it is `%APPDATA%\<app>\config.json`. The platform chooses only the variable; the plugin builds every path with the running process's path rules. On every other platform, macOS included, it is `$XDG_CONFIG_HOME/<app>/config.json`, or `$HOME/.config/<app>/config.json` when `XDG_CONFIG_HOME` is empty or unset. With no variable to derive it from, there is no user file. The user file needs nothing from the author beyond installing the plugin.
- **Project files.** The application lists project files, `config({ files: ['.textstat.json'] })`. The first listed file is the most specific. A relative path resolves against `host.cwd`, and the plugin walks no parent directory. The user file always ranks after every project file.
- **Key by key.** For each requested option, the first file in rank order that holds the option's path answers, and the answer's label names that file. A file with one key hides nothing else another file holds.
- **`--config` replaces.** A run that gives `--config <path>` reads that file alone. The project files and the user file are not read, so a caller that pins a file gets a run that no ambient file changes.
- **Discovered files are lenient.** A project file or the user file that does not exist is silent. One that cannot be read, is not JSON, or does not hold a JSON object at the top warns once in a fixed sentence and is skipped.
- **The named file is strict.** A `--config` file that does not exist, cannot be read, is not JSON, or does not hold an object fails the run as a usage failure on `--config` with code 2. The plugin reads it only when some value is needed, under ADR-0032's lazy load, so a run that needs none never learns of a bad file and its result is what a good file would give.
- **A wrong value is a usage failure.** When the file that answers a request holds a value the option cannot take, the run fails with code 2, named by its label, and like every source `InputError` it takes the place of every validation problem. A later file's value for a path an earlier file answers is never read.
- **Value shapes.** A string option takes a JSON string, or a JSON number as its JSON text. A Boolean option takes a JSON Boolean. A multiple option takes an array whose items each follow the string rule.
- **Paths.** A binding names a dotted path, and each segment is one object key, with no escaping and no array indexing. A path that does not lead to a value, including one that meets a non-object partway, is not in that file.
- **Text.** Every sentence the plugin writes is fixed and carries no parser message, so the bytes are the same under Node and Bun and no file content reaches the terminal. Every control character in a file path is escaped before it enters a label, a warning, or a failure.

## Considered options

- **Rung 1 reads only files the author names, with the user path a helper the author calls.** Rejected. Every application would write the same line, and the purpose of the tier is setting a value once.
- **The most specific existing file answers everything.** Rejected. A project file with one key would hide every setting in the operator's user file.
- **`--config` as one more layer on top.** Rejected. A stray user file on a CI machine would leak into a run its caller thought was pinned, and overriding one key is the work of the flag and the variable at higher tiers.
- **Lenient everywhere, as the earlier corpus chose.** Rejected for the named file. An agent that mistypes `--config` would get a run on defaults with exit code 0.
- **Strict everywhere.** Rejected. One broken user file would fail every run of the application.
- **The user file under `~/Library/Application Support` on macOS.** Rejected. Command-line tools use `~/.config` on macOS, where operators look, and one rule serves every Unix.
- **An ancestor walk from the working directory.** Deferred. Adding a walk later breaks nothing, and removing one would.
- **The parser's message in the warning.** Rejected. It differs between runtimes and quotes file content.

## Consequences

The plugin reads files, so it is the first module in `@loomcli/plugins` to import `node:fs/promises` and `node:path`, which Node and Bun both provide under [ADR-0011](0011-bun-first-workflow-with-a-portable-core.md). It relies on the context and the `InputError` rule of [ADR-0038](0038-a-configuration-source-warns-and-reports-input-problems-through-the-ordinary-channels.md). TOML, YAML, an ancestor walk, a variable for `--config`, and extended help printing configuration keys stay out of this release.

## Status

Proposed. It moves to accepted with the implementation in `@loomcli/plugins/config` and textstat's adoption, proven under Node and Bun by the configuration acceptance in `docs/core.md`.

## Changelog

- 2026-09-26: Proposed with the configuration plugin contract.
