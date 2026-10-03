---
type: adr
title: ADR-0054 - The configuration plugin reads TOML and YAML files chosen by the author's file pattern
description: The configuration plugin reads TOML and YAML beside JSON. A `.toml`, `.yaml`, or `.yml` extension chooses a non-JSON parser, and every other name, one with no extension or an extension the plugin does not recognize included, still reads as JSON. The author names each project file and the user file with a file pattern that may hold `*` or a brace list as its extension alone, the user file name becomes the `file` setting with `config.json` as its default, and glob syntax the plugin cannot read throws at the `config()` call. Both parsers load only when a file of their kind is read. This supersedes ADR-0039's JSON-only format, its fixed user file name, and its clause that TOML and YAML stay out.
status: proposed
created: 2026-10-03
modified: 2026-10-03
---

# ADR-0054 - The configuration plugin reads TOML and YAML files chosen by the author's file pattern

## Context

[ADR-0039](0039-the-configuration-plugin-reads-layered-json-files-and-fails-only-on-the-file-the-operator-names.md) gave the configuration plugin JSON files alone, fixed the user file's name at `config.json`, and left TOML and YAML out. Operators write configuration by hand, and many command-line tools read TOML or YAML because both hold comments and neither quotes its keys. To read them, the plugin has to know which format each file is in and which names it looks for.

Two facts constrain the answer. A shipped application can already list a name with no extension, such as `.textstatrc`, or with an extension of its own choosing, such as `.textstat.conf`, and that file reads as JSON. And the plugin cannot tell a format from a file's content: a file that fails to parse gives no evidence of the syntax its writer meant, so a warning could not say which syntax to correct.

## Decision

- **The extension chooses the parser.** `.toml` reads as TOML 1.0, and `.yaml` and `.yml` as YAML 1.2. Every other name reads as JSON: `.json`, a name with no extension, such as `.textstatrc`, and a name with any other extension, such as `.textstat.conf` or `config.cfg`, so every name an application lists today reads as it did. This holds for project files, the user file, and the `--config` file alike. The file name is the path's last segment, and its extension is the text after its last `.`, unless that `.` is the name's first character. Extensions compare as written, so `.TOML` reads as JSON.
- **The author's file pattern.** Each `files` entry and the user file name is a file pattern. Glob syntax, the characters `*`, `?`, `[`, `]`, `{`, and `}`, may appear only as the whole extension, in one of two forms. `*` accepts any format the plugin reads, `config.*`. A brace list accepts the formats it lists, `config.{toml,yaml}`, and lists only `json`, `toml`, `yaml`, and `yml`. A name with no glob syntax is literal, and its extension locks its format: `.textstat.yaml` reads only as YAML, and `.textstat.conf` only as JSON.
- **Candidates.** A pattern names its candidates in order: a brace list in its listed order, where an extension listed twice counts at its first position, and `*` as `toml`, `yaml`, `yml`, then `json`. A literal name is its own single candidate.
- **The first present candidate answers for the pattern.** The plugin reads the first candidate that something is at, and that file holds the pattern's place in the rank ADR-0039 defines. Every later candidate that is also present is skipped and never read, and the plugin warns once for the pattern, ahead of any warning about the file it reads: `Skipped <file>: <chosen> matches the same pattern first. Keep one of the files, and remove the others.` `<file>` lists every skipped candidate in candidate order, joined by `, `. A broken first candidate warns and is skipped as any broken discovered file is, and the next candidate does not answer in its place. A pattern with no present candidate is a file that does not exist, so it is silent.
- **The user file name is a setting.** `config({ file })` names the user file: `file`, singular, is the user file, and `files`, plural, lists the project files. Its default is `config.json`, so an application that sets nothing reads the user file it read before. The name is a file pattern for one file in the per-user directory ADR-0039 derives from the application name: it holds no path separator, `/` or `\`, and is not `.` or `..`.
- **Faults at the call.** Under [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md), `config()` checks every pattern when it is called, after the existing `@loomcli/plugins/config/files` checks. A user file name that is not a string, is empty, holds a control character or a path separator, or is `.` or `..` throws under a new rule, `@loomcli/plugins/config/file-name`: `Plugin "@loomcli/plugins/config" file is not a file name.`, corrected by `Supply one file name, such as config.toml, with no path separator and no control character.` Glob syntax anywhere but as a whole extension of `*` or a brace list, in a directory segment, in the name before its extension, or in an extension such as `t*`, throws under a new rule, `@loomcli/plugins/config/file-pattern`: `Plugin "@loomcli/plugins/config" file 0 holds glob syntax other than an extension of * or a brace list.`, corrected by `Write the name literally, and use * or a brace list only as the whole text after its last dot.` A brace list that lists anything other than `json`, `toml`, `yaml`, and `yml`, such as `config.{toml,ini}` or an empty item, throws under the same rule: `Plugin "@loomcli/plugins/config" file 0 lists an extension the plugin cannot read.`, corrected by `List only json, toml, yaml, or yml in the braces, or use * for any of them.` The glob check runs first, and a literal name never meets the second sentence. For the user file name, each sentence reads `file` in place of `file 0`: `Plugin "@loomcli/plugins/config" file holds glob syntax other than an extension of * or a brace list.` Each finding rebuilds the `config()` call and marks the entry or `file`.
- **`--config` takes a path.** The operator's path is not a pattern, so `*` and braces in it are part of the name. Its extension chooses the parser by the same rule, so a name a tool such as `mktemp` picks reads as JSON.
- **Parsers.** YAML reads through `yaml` (ISC) under the YAML 1.2 core schema, so `no`, `yes`, `on`, and `off` stay strings. TOML reads through `smol-toml` (BSD-3-Clause) under TOML 1.0. Both become runtime dependencies of `@loomcli/plugins`. The plugin loads each with a dynamic import of a static specifier only when it has read the text of a file of that kind, so an application whose files are JSON never loads either.
- **What a YAML file holds.** One document, with unique keys and only the tags the core schema defines. A second document, a repeated key, a tag the core schema does not define, such as `!!binary`, `!!timestamp`, or a local `!tag`, and a mapping key that is itself a mapping or a sequence make the file not valid YAML. An anchor's alias reads as the value it names. A scalar key that is not a string reads as its text.
- **The top level.** The object ADR-0039 reads is a JSON object, a TOML table, or a YAML mapping. A TOML document is always a table at the top, so an empty TOML file answers nothing and TOML has no clause for a top level of the wrong kind. An empty YAML file, and one that holds only comments, holds no mapping.
- **Value shapes.** ADR-0039's shapes hold for every format, read from the value the parser returns:
  - A string option takes a string as it is, and a number as its text. A finite number reaches it as `JSON.stringify` writes it, whatever the format wrote: TOML `5_000` and `0x1F` reach it as `5000` and `31`, and `1.0` as `1`. A TOML integer beyond the safe range, `-(2^53 - 1)` through `2^53 - 1`, reaches it as its exact decimal digits: the plugin reads it as a `bigint`, so it neither rounds nor lets the parser reject the document. A TOML date or time reaches it as its text as written in the file: `1979-05-27T07:32:00-08:00`, `1979-05-27 07:32:00`, `1979-05-27`, and `07:32:00.5` each fill as written. The YAML core schema has no date type, so `2001-12-14` is already a string.
  - A Boolean option takes a TOML Boolean or a YAML core-schema Boolean, `true`, `True`, `TRUE`, or their `false` forms. A YAML `no` is a string, so a Boolean option given one is a wrong value.
  - A multiple option takes a TOML array or a YAML sequence whose items each follow the string rule.
  - Every other value is a wrong value under ADR-0039's rule, unchanged: the run fails with code 2 and the existing issue sentence. A YAML null, written `null`, `~`, or as a key with no value, is one, as a JSON `null` is. Infinity and not-a-number, TOML `inf` and `nan` and YAML `.inf` and `.nan`, are not finite numbers, as an overflowing JSON literal is not.
- **Sentences.** Three clauses join JSON's in the plugin's one clause table, each with the fix for a discovered file and for the `--config` file, under ADR-0039's split: a discovered file warns once and is skipped, and the `--config` file fails the run with code 2.
  - `is not valid TOML.`, fixed by `Correct its syntax, or remove it.` for a discovered file and `Correct its syntax, or supply another file.` for the named file.
  - `is not valid YAML.`, with the same two fixes.
  - `does not hold a YAML mapping.`, fixed by `Write its settings as one YAML mapping, or remove it.` and `Write its settings as one YAML mapping.`
- **Text.** Every sentence stays fixed and carries no parser message, the YAML parser's warnings included, and every path the plugin shows escapes control characters as ADR-0039 states, the candidates the several-candidates warning names included.

Everything else in ADR-0039 stands: the derived per-user directory, the rank, key-by-key answers, `--config` replacing every other file, discovered files lenient and the named file strict, wrong values, and paths.

## Considered options

- **A bare name means any format.** `config` would read `config.toml`, `config.yaml`, `config.yml`, or `config.json`. Rejected, because it would silently change what a shipped extensionless name such as `.textstatrc` reads.
- **The format read from the content.** Rejected. A file that fails to parse gives no evidence of the syntax its writer meant, so the warning could not say what to correct.
- **An unrecognized literal extension throws at `config()`.** Rejected. Loom does not dictate an author's file names, and an application that lists `.textstat.conf` holding JSON today would break. Such a name reads as JSON, as a name with no extension does.
- **The next candidate answers when the first is broken.** Rejected. Which file answered would depend on whether another parses, and the operator would correct a file the run then stops reading.
- **Every present candidate answers, key by key.** Rejected. Two files for one pattern are a mistake, and merging them hides which file holds a key.
- **A TOML integer beyond the safe range is a wrong value, or fails the document.** Rejected. The file wrote an exact integer, and a number reaches a string option as its text. Failing the document, the parser's default, would also discard every other key in the file.
- **The YAML 1.1 schema.** Rejected. It reads `no` and `off` as `false`, so a string value such as a country code changes type.

## Consequences

The pattern check rejects only names that hold glob syntax outside the two extension forms, such as a `files` entry with `[` or `{` in a directory or file name, which an earlier release read literally. Every name without glob syntax reads as it did, an unrecognized extension included, so an application that lists such names is unchanged.

`@loomcli/plugins` gains its second and third runtime dependencies beside `zod`. npm installs each as its own package with its own license file, so the pack's `license` field, `MIT AND Apache-2.0`, still describes the pack's own files, and its NOTICE still covers only the Cobra code ported into them; neither changes. An application that bundles itself carries both parsers' code and keeps their notices with its bundle, as it already does for `zod`. The dynamic imports name static specifiers, so a bundler resolves them as it resolves the plugin's own lazily loaded resolver.

A TOML date or time reaches an option as the file wrote it. `smol-toml` returns a date object whose text adds milliseconds and writes `T` for a space, and it keeps no source text, so the implementation must recover the written text and never add precision or change a separator the file did not write.

An ancestor walk, a variable for `--config`, and extended help printing configuration keys still stay out, as ADR-0039 left them.

## Status

Proposed with the contract in [Configuration](../core.md#configuration). It moves to accepted when the implementation lands in `@loomcli/plugins/config` with tests that prove these rules under Node and Bun through the configuration acceptance.

## Changelog

- 2026-10-03: Proposed with the contract.
