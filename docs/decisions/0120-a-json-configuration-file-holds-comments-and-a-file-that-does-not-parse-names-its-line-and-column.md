---
type: adr
title: ADR-0120 - A JSON configuration file holds comments and trailing commas, and a file that does not parse names its line and column
description: Every file the configuration plugin reads as JSON accepts // and /* */ comments and a comma after the last item of an object or an array, whatever its extension, and jsonc joins the extensions a brace list may name, the candidates * tries after json, and the XDG user file. A file that does not parse names the line and column where it breaks, in the broken-file warning and in the --config failure, counted the same way for JSON, TOML, and YAML. The sentence stays fixed, with no parser message. This narrows ADR-0054's JSON format and its fixed sentences, and ADR-0119's broken-file sentences and user file.
status: proposed
created: 2026-10-29
modified: 2026-10-29
---

# ADR-0120 - A JSON configuration file holds comments and trailing commas, and a file that does not parse names its line and column

## Context

[ADR-0054](0054-the-configuration-plugin-reads-one-file-per-run-found-by-the-authors-file-pattern.md) reads every name that is not TOML or YAML as JSON through `JSON.parse`, so the default `.<app>.json` cannot hold a note. Configuration often carries the reason for a value beside it, and tsconfig, VS Code's settings, and Deno's `deno.json` read comments in a `.json` file. The owner: "Good config sometimes carries the reasons with the config, so this helps keep the parser working well for a broad audience."

A file that does not parse warns with a fixed sentence, such as `Skipped .collector.toml: the file is not valid TOML, so this run reads no configuration.`, which names no place. git, Cargo, and Taplo point to the line. `smol-toml` and `yaml` report a position, but `JSON.parse` reports none in a form that is the same under Node and Bun: V8 and JavaScriptCore word their messages differently, and ADR-0054 keeps every sentence fixed so its bytes do not change between runtimes.

## Decision

- **JSON with comments.** Every file the plugin reads as JSON, `.json`, `.jsonc`, a name with no extension, and a name with any other extension, accepts `//` and `/* */` comments wherever JSON allows whitespace, and one comma after the last item of an object or an array. A file in strict JSON reads as it did. Nothing else of JSON5 joins: keys are quoted, strings use double quotes, and numbers are JSON's.
- **The scan.** The plugin scans the text itself, with no new dependency. A text that passes has each comment and trailing comma blanked to spaces, and `JSON.parse` builds its value, so a value reads as `JSON.parse` reads it, a `__proto__` key included.
- **`jsonc` is accepted, never required.** A brace list may list `jsonc`, `*` tries `jsonc` after `json`, and a pattern candidate whose extension is `jsonc` makes the XDG user file `config.jsonc`. A `.jsonc` file reads as JSON, as it already did as a name with another extension.
- **Where a file breaks.** A discovered file or the variable's file that does not parse warns `Skipped <file>: the file is not valid TOML at line 3, column 7, so this run reads no configuration. Correct its syntax, or remove it.`, and a `--config` file fails with `File "<path>" is not valid TOML at line 3, column 7. Correct its syntax, or supply another file.`, for each of JSON, TOML, and YAML. A file that parses but does not hold an object or a mapping names no position.
- **One count for every format.** Lines and columns count from 1. A line ends at LF, at CRLF, or at a lone CR. A column counts characters, one per code point, so an emoji counts once and a tab counts once. A leading byte order mark is not a column. The plugin reads each parser's offset or line and column and counts again under this rule, so the position is the same whichever parser found it and whichever runtime runs it.
- **What each format names.** JSON names the first character the scan cannot accept, and the end of the text when it ends early. TOML names the place `smol-toml` names. YAML names the place of `yaml`'s first error, or else of a tag outside the core schema, or else of an alias that names no preceding anchor.
- **Fixed text.** The sentence carries two numbers and no parser message and no file content, so ADR-0054's fixed, escaped text stands.

## Considered options

- **Comments only in a `.jsonc` file, with `.json` strict, as c12 splits them.** Rejected. The default file name could never hold a note, and an operator would rename a file to explain a value.
- **Comments with no trailing comma, as the JSONC specification reads.** Rejected. An operator editing by hand often leaves one, and the file would then be skipped with a warning; tsconfig and VS Code accept it.
- **A JSONC parser package.** Not taken. The scan is small, it gives the position directly, and `JSON.parse` keeps building the value, so a value reads exactly as before and the pack gains no dependency.
- **A column in UTF-16 units, as the parsers count.** Rejected. An operator reads characters, and the count would differ between a file with an emoji before the fault and one without.

## Consequences

A file that failed to parse because of a comment or a trailing comma now reads, so an operator who relied on that failure to disable a file sees its values. The broken-file sentences change their bytes, which the implementation's fragments state. LM-375 and LM-379 carry the work, and [Configuration plugin](../plugins/config.md) carries the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-10-29: Proposed with the implementation (LM-375, LM-379). It narrows ADR-0054's clause that every other name reads through `JSON.parse`, its brace-list extensions and `*` candidates, and its fixed sentences, and ADR-0119's broken-file sentences and its user file extensions. ADR-0054 and ADR-0119 carry dated entries.
