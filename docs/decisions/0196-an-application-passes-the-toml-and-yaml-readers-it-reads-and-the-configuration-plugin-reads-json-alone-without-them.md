---
type: adr
title: ADR-0196 - An application passes the TOML and YAML readers it reads, and the configuration plugin reads JSON alone without them
description: The configuration plugin reads JSON itself and reads TOML and YAML only through the reader values an application passes in a new formats setting, toml from @loomcli/plugins/config/toml and yaml from @loomcli/plugins/config/yaml. The plugin's own modules import neither reader, so an application bundles only the parsers it passes. With no formats an application reads JSON alone, a file pattern that names toml, yaml, or yml without its reader throws at configuration(), * names the extensions of the readers passed and then json and jsonc, and --config naming a TOML or YAML file the application does not read fails with a sentence that names the file's format and the formats it reads. The loom bin passes no readers. This supersedes ADR-0054's clause that the extension chooses the parser among every format the plugin reads, and narrows its parsers and file-pattern clauses and ADR-0130's --config clause.
status: proposed
created: 2026-11-19
modified: 2026-11-19
---

# ADR-0196 - An application passes the TOML and YAML readers it reads, and the configuration plugin reads JSON alone without them

## Context

[ADR-0054](0054-the-configuration-plugin-reads-one-file-per-run-found-by-the-authors-file-pattern.md) has the configuration plugin choose a file's parser by its extension at run time: `.toml` reads as TOML through `smol-toml`, `.yaml` and `.yml` as YAML through `yaml`, and every other name as JSON. The plugin loads each parser with a dynamic import of a static specifier only when it reads a file of that kind, so a JSON run never loads either.

A dynamic import keeps the parser out of a run, not out of a bundle. `loom build` runs `bun build --splitting`, which follows every static specifier, dynamic ones included, and writes each parser as a chunk. Every application that installs the plugin therefore ships both parsers, about 266 KB, and carries their ISC and BSD-3-Clause notices, whatever format its own file uses. The `loom` bin reads `loom.config.json` alone, yet its bundle held `smol-toml`, and its `license` field named BSD-3-Clause for it.

The plugin cannot learn at build time which formats an application reads, because the extension is only known when a run reads a file. The application knows, because its author writes the file pattern.

## Decision

- **Reader values.** The pack exports one reader per format beyond JSON, each from its own subpath: `toml` from `@loomcli/plugins/config/toml`, which reads `.toml` files, and `yaml` from `@loomcli/plugins/config/yaml`, which reads `.yaml` and `.yml` files. A reader is a sealed value of the type `ConfigurationReader`, exported from `@loomcli/plugins/config` with `ReaderFormat`, `'TOML' | 'YAML'`. A reader shows only its format and a brand, a `unique symbol` key that holds no runtime value, as core's opaque declaration types carry, so an object an author writes with a `format` does not type-check where a reader is expected; the plugin finds the function that parses a file's text by the reader value itself, so the plugin's reading of a file stays internal and only the pack makes a reader. A reader loads its parser package with a dynamic import only when a run reads a file of its format, as ADR-0054's parsers do.
- **`formats`.** `configuration()` takes a new setting, `formats`, a list of readers: `configuration({ formats: [toml, yaml], ... })`. A reader listed twice counts once, and the order of the list changes nothing. JSON and JSONC are built in and need no reader.
- **The import graph.** The plugin's own modules import neither reader. They know only which extension names which format, so a reader the application does not import is never in its import graph, and a bundler leaves out its parser and its license.
- **JSON alone by default.** With no `formats`, an application reads JSON alone. This is a breaking change from ADR-0054, under which every application read all three formats.
- **The extension still chooses.** A file's extension chooses its parser as ADR-0054 states, among the readers passed: `.toml` reads through the TOML reader, `.yaml` and `.yml` through the YAML reader, and every other name as JSON with comments, `.json`, `.jsonc`, no extension, and any other extension alike.
- **A pattern needs its readers.** After the path rule and the pattern rule, `configuration()` judges the candidates its `file` names. A candidate whose extension is `toml`, `yaml`, or `yml`, listed in braces or a literal name, with no reader for its format in `formats` throws a `DeclarationError` under a new rule, `@loomcli/plugins/config/file-format`: `Plugin "@loomcli/plugins/config" file names toml files, and formats holds no reader for them.`, corrected by `Pass toml, from @loomcli/plugins/config/toml, in formats.` The finding marks `file`. The sentence names the first such candidate's extension, and the correction names the reader that reads it, `yaml` for `yml`. A brace list may still list only `json`, `jsonc`, `toml`, `yaml`, and `yml`, under the pattern rule, whatever `formats` holds.
- **`*` names what the application reads.** An extension of `*` names the extensions of the readers passed, `toml` and then `yaml` and `yml`, in that order whatever the order of `formats`, then `json` and `jsonc`. With no readers it names `json` and `jsonc` alone. ADR-0054 has `*` accept "any format the plugin reads", and the formats the plugin reads are now the ones the application passes, so `*` keeps its meaning and its order; it never names a candidate the run could not parse, and with both readers passed it names exactly ADR-0054's and ADR-0120's candidates.
- **`--config` names a format the application does not read.** A file `--config` names whose extension is `toml`, `yaml`, or `yml`, with no reader for its format, fails the run before the plugin reads it, whether or not it exists, as a usage failure on `--config` with code 2: `Option "--config": File "x.toml" is TOML, which this application does not read. Supply a JSON file.` The sentence names the file's format, and the step names every format the application reads, JSON first, as in `Supply a JSON or YAML file.` Any other extension still reads as JSON, as ADR-0054 states. The sentence lives in the plugin's message module under [ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md).
- **The variable's file.** A file the author-named variable of [ADR-0119](0119-the-configuration-lookup-walks-to-home-reads-an-author-named-variable-and-the-xdg-user-file-and-never-falls-back-after-a-broken-file.md) names in such a format is a broken discovered file, unread: it warns once, `Skipped x.toml: the file is TOML, which this application does not read, so this run reads no configuration. Supply a JSON file.`, and the run has no configuration, or fails the run under `strict`, as ADR-0155 states for a broken file. A file the lookup finds always has its reader, because `configuration()` judged the pattern's candidates, and the user file's candidates follow them.
- **The `loom` bin passes no readers.** It reads `loom.config.json` alone, so its bundle holds no `smol-toml`, its `license` field drops BSD-3-Clause, and `loom --config x.toml` fails with the sentence above. `@loomcli/loom` keeps `yaml` and ISC, because the bin parses YAML itself outside its configuration.

## Considered options

- **Keep run-time choice and mark the imports for the bundler to drop.** Rejected. Whether a dynamic import is needed depends on a file an operator writes after the build, so no bundler can drop it safely, and a build flag would split one application's behavior between a development run and its bundle.
- **One subpath per format of the whole plugin, such as `@loomcli/plugins/config/toml` exporting a TOML-reading `configuration()`.** Rejected. An application that reads two formats would have no one call, and the settings would repeat across entry points.
- **A string setting, `formats: ['toml']`.** Rejected. The plugin would still have to import the parser a string names, so the parser would stay in every import graph.
- **Default to every reader.** Rejected. The default would keep the cost the record removes for every application that does not opt out, the `loom` bin included.
- **Read a `--config` file of an unread format as JSON.** Rejected. A `.toml` file that fails to parse as JSON would name a JSON syntax error at its first `=`, which points the operator at the wrong fix.

## Consequences

An application that reads TOML or YAML passes the reader its file pattern names, and one that does not now throws at `configuration()` with the reader to pass. That is breaking, and the implementation carries a breaking fragment with its migration. An application that reads JSON alone changes nothing in its source and drops both parsers from its bundle. `@loomcli/plugins` keeps `smol-toml` and `yaml` as runtime dependencies, because the readers import them, and its `license` field and NOTICE do not change.

This supersedes ADR-0054's clause **The extension chooses the parser** in so far as it reads every format: the extension now chooses among JSON and the readers passed. It narrows ADR-0054's **Parsers** clause, which now holds for each reader's parser, its **The file pattern** clause, under which `*` accepts the formats the application reads, its **Candidates** clause, whose `*` order keeps only the extensions of the readers passed, and its **Faults at the call**, which gain the reader rule. It narrows [ADR-0130](0130-the-loom-toolchain-reads-loom-config-json-from-the-package-directory-and-every-path-it-owns-is-a-key.md)'s clause that `--config <path>` reads a file of any name: the `loom` bin reads a file of any name that is not a TOML or YAML file. ADR-0054, ADR-0119, ADR-0130, and ADR-0155 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-19: Proposed with the reader subpaths (LM-552).
