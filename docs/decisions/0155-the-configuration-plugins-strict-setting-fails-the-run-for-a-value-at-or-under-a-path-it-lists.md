---
type: adr
title: ADR-0155 - The configuration plugin's strict setting fails the run for a value at or under a path it lists
description: configuration() gains strict, true or a non-empty list of dotted key paths. Each value the drop rule would remove, and each unknown key, at or under a listed path, or anywhere under true, fails the run in place of its -v line, as one InputError with code 2 that names every such key with its file, the schema's message, and what to do. A linked option whose path strict covers fails on a value it cannot take, and core fails a covered fill its validator rejects instead of falling back, through a new strict field on SourceAnswer. Without strict nothing changes. It supersedes ADR-0118's drop clause, and narrows ADR-0117's fallback, for what strict covers.
status: proposed
created: 2026-11-14
modified: 2026-11-14
---

# ADR-0155 - The configuration plugin's strict setting fails the run for a value at or under a path it lists

## Context

[ADR-0118](0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) made the configuration file forgiving. A value the configuration schema rejects is dropped and named at `-v`. A key's value falls back to its schema default, and a linked option falls back to its own default. [ADR-0117](0117-a-configuration-value-its-validator-rejects-falls-back-and-validates-against-its-files-directory.md) does the same in core for a configuration fill that the option's validator rejects. [ADR-0154](0154-the-configuration-plugin-names-at-v-each-key-the-published-json-schema-does-not-describe.md) names unknown keys at `-v` too. Under all three records, nothing in the file fails a run.

That serves an operator at a shell. It does not serve a service that systemd or launchd supervises, where nobody reads `-v`. Heimdall hit this case. A wrong `[delivery]` value is dropped, the section falls back to its defaults, and alert delivery stops with no failure and no line in the supervisor's log. To avoid that, Heimdall keeps such sections as `z.unknown()` and validates `provided.config` itself. Loom then never validates those sections, and the published JSON Schema says nothing about them.

The owner settled four questions in grooming (LM-509):

- **Selection.** The owner agreed with the recommendation that the plugin's settings gain `strict`. `true` makes every schema issue fail the run. A list of key paths fails the run only for an issue at or under a listed path. Everything else drops and falls back as today.
- **Unknown keys.** The owner agreed with the recommendation that an unknown key at or under a strict path fails the run as a wrong value does. Elsewhere it is only named at `-v`. The listed paths follow the rule for a linked option's `path`.
- **Linked options.** The owner answered "Yes" to covering linked options through the same setting and the option's linked path. A wrong-typed or validator-rejected file value for a covered option fails the run instead of falling back.
- **The failure.** The owner answered "Yes" to an input failure with exit code 2 that lists every issue at once. The alternative was a general failure with exit code 1 that names the first issue only.

## Decision

- **`strict` selects.** `configuration({ strict })` takes `true`, or a non-empty list of dotted key paths. `false` or no value at all keeps today's behavior, so without `strict` the plugin writes the same bytes it writes today. A listed path follows the rule for a linked option's `path`: it splits on `.`, each segment is one nonempty object key, and there is no escaping and no array indexing. `configuration()` throws a `DeclarationError` for a listed path that breaks the rule, under `@loomcli/plugins/config/strict-path`, as `configInput` rejects such a path at its call. Where the schema publishes a JSON Schema, the `onGraphBuilt` hook judges each listed path as it judges a link's path. A path whose keys the shape does not hold throws `@loomcli/plugins/config/strict-schema-path`, which catches a typo that would otherwise make the setting cover nothing.
- **At or under.** A path in the file is at or under a listed path when the listed path's segments are its first steps, each step an object key equal to its segment. An array item's index equals no segment, so a list covers an array's items by naming the array's own key. A removal with no steps, which removes every key, is under no listed path. A value that holds a listed path is not at or under it, so a misspelled section, such as `[delivry]` for `[delivery]`, is covered by `strict: true` alone.
- **The drop rule runs as before, and its covered lines become the failure.** The drop loop and the unknown-key walk run as they do today. Each value the loop removes at or under a listed path, and each unknown key the walk finds there, is collected instead of written as a `-v` line. A removal is judged by the path its `-v` line would name. Every other value writes its line as today. When the read has collected anything, the run fails. So one failure holds every covered removal and every covered unknown key, as `-v` would have listed them, in the same order. Under `strict: true` every removal and every unknown key is covered.
- **Unknown keys need a JSON Schema.** The plugin learns that a key is unknown only from the published JSON Schema, under ADR-0154. A schema that publishes none, such as valibot's, or one whose converter fails, gives `strict` no unknown key to fail on, while a value it rejects still fails the run. Such an author can write a strict object, such as valibot's `strictObject`, so that the schema itself reports the key as an issue.
- **Linked options.** A linked option is covered when `strict` is `true`, or when its `configInput` path is at or under a listed path. When the source cannot take a covered option's value, it adds that option's problem to the failure instead of writing its `-v` line. A covered answer carries `strict: true`. Core then judges that answer as it judges an environment fill: a value the option's validator rejects, or a content path core cannot read, fails the run with code 2, under core's diagnostic for a filled value, instead of falling back. Core runs the validator after the source returns, so a validator rejection reaches the operator in the validation phase's failure and not in the read's. A source failure takes the place of every problem collected, so a run whose source threw reports no validator rejection, and the rejection shows on the next run.
- **The failure.** The source throws the failure, or the provider throws it when the provider reads first. It is an `InputError` with code 2: the class, code, and holding rules of a broken `--config` file. Its first problem, present when the read held a covered removal or a covered unknown key, names `--config`, the plugin's option for the configuration file, whichever step found the file, and it carries one issue for each covered removal and each covered unknown key. Each linked option the source could not take follows as its own problem, in the order of its request. The message has one line for each issue.
- **The sentences.** Each line carries the parts of the `-v` line it replaces: the key's path, the file as its labels show it, and the schema's message for a removed value. It ends with what to do:
  - `Configuration value <path> in <file>: <message>. Correct the value, or remove it.`
  - `Configuration file <file>: <message>. Correct the file, or remove it.`, for a removal with no steps.
  - `Unknown key <path> in <file>. Check its spelling, or remove it.`
  - `Option "<spelling>" (from <label>): <message>`, core's own form for a filled value, with an issue's position after the parenthesis.

  The path and the file are escaped, and the schema's message is escaped too. A period follows the message unless it already ends in one, as the `empty-file` fault's sentence adds one.
- **The schema's message may print.** Rule 6 of the failure message voice bars text that Loom did not write: a thrown cause, an engine reason, or a stack. The schema belongs to the application. Its message is the issue that the author's validator returns for the operator, as an option validator's message is, which core prints in every invalid-value failure, and which this plugin already prints at `-v`. Whether that message repeats a value is the author's choice under rule 4, as it is for an option's validator. A key path is the file's structure, as a spelling is, and the plugin repeats it as its labels already do in core's failures.
- **Nothing else changes.** A missing or broken file keeps its rules, so only the named file fails the run for being missing or broken. The empty-file fault is unchanged. The top-level `$schema` key never meets the schema, so it never fails a run. `provided.config` and the published JSON Schema are unchanged, and so is every line and every exit code of a run that `strict` does not cover.

[Configuration plugin](../plugins/config.md#the-strict-setting) and [Input sources](../core/input-sources.md#configuration-sources) carry the contract.

## Considered options

- **`strict: true` alone.** Not chosen in grooming. A whole-file switch would make every cosmetic setting fatal for an application that needs only its delivery section to be right.
- **A marker in the schema, such as a zod `meta`.** Not chosen in grooming. Standard Schema exposes no shape at run time, and a marker would work for one library alone.
- **A general failure with code 1 that names the first issue.** Not chosen in grooming. The operator would fix one key per run, and the failure would read as an application fault rather than a fault in the file the operator wrote.
- **Lines that open with `Option "--config":`.** Not taken. Most runs find the file by lookup or through the variable, and the operator never typed `--config`. The problem still names `--config` as its input, as the problem for a broken named file does.
- **Judging an issue by the path the schema reports instead of the value the drop rule removes.** Not taken. The `-v` line names the value it removes, and the failure replaces that line, so the two name the same path and judge the same path.
- **Covering a value that holds a listed path.** Not taken. The settled rule is "at or under". An author who wants a section's own type judged lists the section itself, and `strict: true` covers a misspelled section.
- **Having the source run the option's validator.** Rejected. A source has no validator to call, and running the validator twice would differ from core's single call and its context. An optional field on the answer leaves the validator call where it is.

## Consequences

`ConfigurationSettings` gains an optional `strict`. `SourceAnswer`, an input type, gains an optional `strict`, so a third-party configuration source can opt in as well. Neither change breaks existing code, so one feature fragment covers both. The plugin's `load` still runs the loop and the walk once per read, and it holds the covered lines until the read ends. The source marks each covered answer. Core's validation skips the fallback for an answer marked strict, so it reports the rejection through the path it already uses for an environment fill.

ADR-0118's drop clause, which says a rejected value is dropped and named at `-v` and never fails a run, is superseded for what `strict` covers, and so is its statement that a value its validator rejects falls back. ADR-0117's rule that a rejected configuration fill falls back is narrowed for an answer marked strict. ADR-0154's lines stand for every key that `strict` does not cover. ADR-0117 and ADR-0118 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-14: Proposed with the contract for the strict setting (LM-509). It supersedes ADR-0118's drop clause and its fallback for a linked option's rejected value for what `strict` covers, and narrows ADR-0117's fallback for an answer marked strict. ADR-0117 and ADR-0118 carry dated entries.
