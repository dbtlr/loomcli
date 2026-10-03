---
type: adr
title: ADR-0054 - The configuration plugin reads TOML and YAML files chosen by the author's file pattern
description: The configuration plugin reads TOML and YAML beside JSON, and a file's extension chooses its parser, with a name that has no extension still read as JSON. The author names each project file and the user file with a file pattern that may hold glob syntax in the extension position alone, the user file name becomes the `userFile` setting with `config.json` as its default, and a pattern the plugin cannot read throws at the `config()` call. Both parsers load only when a file of their kind is read. This supersedes ADR-0039's JSON-only format, its fixed user file name, and its clause that TOML and YAML stay out.
status: proposed
created: 2026-10-03
modified: 2026-10-03
---

# ADR-0054 - The configuration plugin reads TOML and YAML files chosen by the author's file pattern

## Context

[ADR-0039](0039-the-configuration-plugin-reads-layered-json-files-and-fails-only-on-the-file-the-operator-names.md) gave the configuration plugin JSON files alone, fixed the user file's name at `config.json`, and left TOML and YAML out. Operators write configuration by hand, and many command-line tools read TOML or YAML because both hold comments and neither quotes its keys. To read them, the plugin has to know which format each file is in and which names it looks for.

Two facts constrain the answer. A shipped application can already list a name with no extension, such as `.textstatrc`, and that file reads as JSON. And the plugin cannot tell a format from a file's content: a file that fails to parse gives no evidence of the syntax its writer meant, so a warning could not say which syntax to correct.

## Decision

- **The extension chooses the parser.** `.json` reads as JSON, `.toml` as TOML 1.0, and `.yaml` and `.yml` as YAML 1.2. A file name with no extension reads as JSON, so `files: ['.textstatrc']` reads as it did. The file name is the path's last segment, and its extension is the text after its last `.`, unless that `.` is the name's first character. Extensions compare as written, so `.JSON` is not `.json`.
- **The author's file pattern.** Each `files` entry and the user file name is a file pattern. Glob syntax, the characters `*`, `?`, `[`, `]`, `{`, and `}`, may appear only in the extension position, in one of two forms. `*` accepts any format the plugin reads, `config.*`. A brace list of extensions the plugin reads accepts those, `config.{toml,yaml}`. A literal extension locks the format, `.textstat.yaml`.
- **Candidates.** A pattern names its candidates in order: a brace list in its listed order, where an extension listed twice counts at its first position, and `*` as `toml`, `yaml`, `yml`, then `json`. A literal name is its own single candidate.
- **The first present candidate answers for the pattern.** The plugin reads the first candidate that something is at, and that file holds the pattern's place in the rank ADR-0039 defines. Every later candidate that is also present is skipped and never read, and the plugin warns once for the pattern, ahead of any warning about the file it reads: `Skipped <file>: <chosen> matches the same pattern first. Keep one of the files, and remove the others.` `<file>` lists every skipped candidate in candidate order, joined by `, `. A broken first candidate warns and is skipped as any broken discovered file is, and the next candidate does not answer in its place. A pattern with no present candidate is a file that does not exist, so it is silent.
- **The user file name is a setting.** `config({ userFile })` names the user file, and its default is `config.json`, so an application that sets nothing reads the user file it read before. The name is a file pattern for one file in the per-user directory ADR-0039 derives from the application name: it holds no path separator, `/` or `\`, and is not `.` or `..`.
- **Faults at the call.** Under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md), `config()` checks every pattern when it is called, after the existing `@loomcli/plugins/config/files` checks. A user file name that is not a string, is empty, holds a control character or a path separator, or is `.` or `..` throws under a new rule, `@loomcli/plugins/config/user-file`: `Plugin "@loomcli/plugins/config" userFile is not a file name.`, corrected by `Supply one file name, such as config.toml, with no path separator and no control character.` Glob syntax outside the extension position, and an extension that is neither one the plugin reads, `*`, nor a brace list of extensions it reads, throw under a new rule, `@loomcli/plugins/config/file-pattern`: `Plugin "@loomcli/plugins/config" file 0 holds glob syntax outside its extension.`, corrected by `Write the name literally, and use * or a brace list only after its last dot.`, and `Plugin "@loomcli/plugins/config" file 0 names an extension the plugin cannot read.`, corrected by `Use json, toml, yaml, or yml as the extension, * for any of them, or a brace list of them such as {toml,yaml}.` The glob check runs first. For the user file name, `userFile` replaces `file 0`. Each finding rebuilds the `config()` call and marks the entry or `userFile`.
- **`--config` takes a path.** The operator's path is not a pattern, so `*` and braces in it are part of the name. Its extension chooses the parser the same way, and any extension the plugin does not read is read as JSON, as a name with none is.
- **Parsers.** YAML reads through `yaml` (ISC) under the YAML 1.2 core schema, so `no`, `yes`, `on`, and `off` stay strings. TOML reads through `smol-toml` (BSD-3-Clause) under TOML 1.0. Both become runtime dependencies of `@loomcli/plugins`. The plugin loads each with a dynamic import of a static specifier only when it has read the text of a file of that kind, so an application whose files are JSON never loads either.
- **What a YAML file holds.** One document, with unique keys and only the tags the core schema defines. A second document, a repeated key, a tag the core schema does not define, such as `!!binary`, `!!timestamp`, or a local `!tag`, and a mapping key that is itself a mapping or a sequence make the file not valid YAML. An anchor's alias reads as the value it names. A scalar key that is not a string reads as its text.
- **The top level.** The object ADR-0039 reads is a JSON object, a TOML table, or a YAML mapping. A TOML document is always a table at the top, so an empty TOML file answers nothing and TOML has no clause for a top level of the wrong kind. An empty YAML file, and one that holds only comments, holds no mapping.
- **Value shapes.** ADR-0039's shapes hold for every format, read from the value the parser returns:
  - A string option takes a string as it is, and a finite number as `JSON.stringify` writes it, whatever the format wrote: TOML `5_000` and `0x1F` reach it as `5000` and `31`, and `1.0` as `1`. A TOML date or time reaches it as its TOML text in the parser's normal form, with fractional seconds written to milliseconds: `1979-05-27T07:32:00-08:00` as `1979-05-27T07:32:00.000-08:00`, a local date-time as `1979-05-27T07:32:00.000`, a local date as `1979-05-27`, and a local time as `07:32:00.000`. The YAML core schema has no date type, so `2001-12-14` is already a string.
  - A Boolean option takes a TOML Boolean or a YAML core-schema Boolean, `true`, `True`, `TRUE`, or their `false` forms. A YAML `no` is a string, so a Boolean option given one is a wrong value.
  - A multiple option takes a TOML array or a YAML sequence whose items each follow the string rule.
  - Every other value is a wrong value under ADR-0039's rule, unchanged: the run fails with code 2 and the existing issue sentence. A YAML null, written `null`, `~`, or as a key with no value, is one, as a JSON `null` is. Infinity and not-a-number, TOML `inf` and `nan` and YAML `.inf` and `.nan`, are not finite numbers, as an overflowing JSON literal is not. A TOML integer beyond the safe range, `-(2^53 - 1)` through `2^53 - 1`, which TOML 1.0 forbids a reader to round, is one too: the plugin asks the parser to keep such an integer rather than reject the document, so one value does not discard the file's other keys, and the issue `Use a string or a number.` points at the fix of quoting it. A YAML integer beyond the safe range reads as a JavaScript number, as a JSON one does.
- **Sentences.** Three clauses join JSON's in the plugin's one clause table, each with the fix for a discovered file and for the `--config` file, under ADR-0039's split: a discovered file warns once and is skipped, and the `--config` file fails the run with code 2.
  - `is not valid TOML.`, fixed by `Correct its syntax, or remove it.` for a discovered file and `Correct its syntax, or supply another file.` for the named file.
  - `is not valid YAML.`, with the same two fixes.
  - `does not hold a YAML mapping.`, fixed by `Write its settings as one YAML mapping, or remove it.` and `Write its settings as one YAML mapping.`
- **Text.** Every sentence stays fixed and carries no parser message, the YAML parser's warnings included, and every path the plugin shows escapes control characters as ADR-0039 states, the candidates the several-candidates warning names included.

Everything else in ADR-0039 stands: the derived per-user directory, the rank, key-by-key answers, `--config` replacing every other file, discovered files lenient and the named file strict, wrong values, and paths.

## Considered options

- **A bare name means any format.** `config` would read `config.toml`, `config.yaml`, `config.yml`, or `config.json`. Rejected, because it would silently change what a shipped extensionless name such as `.textstatrc` reads.
- **The format read from the content.** Rejected. A file that fails to parse gives no evidence of the syntax its writer meant, so the warning could not say what to correct.
- **An unknown literal extension reads as JSON in the author's pattern.** Rejected. The author writes the pattern while developing, and a `.ini` read as JSON would warn on every run of the shipped application. The operator's `--config` path is not checked, because nothing sees it before the run and a tool such as `mktemp` picks its name.
- **The next candidate answers when the first is broken.** Rejected. Which file answered would depend on whether another parses, and the operator would correct a file the run then stops reading.
- **Every present candidate answers, key by key.** Rejected. Two files for one pattern are a mistake, and merging them hides which file holds a key.
- **A TOML integer beyond the safe range fails the document.** Rejected. It is the parser's default, but one value would discard every other key in the file.
- **The YAML 1.1 schema.** Rejected. It reads `no` and `off` as `false`, so a string value such as a country code changes type.

## Consequences

The pattern check rejects names an earlier release accepted: a `files` entry whose extension is not one the plugin reads, such as `.textstat.conf`, and an entry that holds glob syntax anywhere. Both throw at `config()`, so the implementation ships as a breaking change whose migration renames such a file to `.json` or drops its extension. An application that lists only `.json` names and extensionless names is unchanged.

`@loomcli/plugins` gains its second and third runtime dependencies beside `zod`. npm installs each as its own package with its own license file, so the pack's `license` field, `MIT AND Apache-2.0`, still describes the pack's own files, and its NOTICE still covers only the Cobra code ported into them; neither changes. An application that bundles itself carries both parsers' code and keeps their notices with its bundle, as it already does for `zod`. The dynamic imports name static specifiers, so a bundler resolves them as it resolves the plugin's own lazily loaded resolver.

The parser's normal form for a TOML date or time keeps three digits of fractional seconds, so finer precision does not reach an option. JSON and YAML read an integer beyond the safe range as a rounded JavaScript number, while TOML makes it a wrong value; ADR-0039's JSON reading is unchanged.

An ancestor walk, a variable for `--config`, and extended help printing configuration keys still stay out, as ADR-0039 left them.

## Status

Proposed with the contract in [Configuration](../core.md#configuration). It moves to accepted when the implementation lands in `@loomcli/plugins/config` with tests that prove these rules under Node and Bun through the configuration acceptance.

## Changelog

- 2026-10-03: Proposed with the contract.
