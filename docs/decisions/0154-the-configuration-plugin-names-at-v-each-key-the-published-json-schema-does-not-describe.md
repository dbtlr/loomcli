---
type: adr
title: ADR-0154 - The configuration plugin names at -v each key the published JSON Schema does not describe
description: Where the configuration schema publishes a JSON Schema, the configuration plugin walks the file it read against the graph's configuration.schema and writes one out.debug line for each key a closed object does not list, judged by the link check's rule, after the lines for removed values and in the dropped-value line's form. Nothing at or below a dropped value, in an open object, or in a file whose schema publishes no JSON Schema prints a line. It supersedes ADR-0118's sentence that such a key is never reported at any verbosity.
status: proposed
created: 2026-11-14
modified: 2026-11-14
---

# ADR-0154 - The configuration plugin names at -v each key the published JSON Schema does not describe

## Context

[ADR-0118](0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) made the configuration file forgiving: a value the configuration schema rejects is a dropped value, named at `-v` so "someone might be trying to figure out why the value in their config file is being ignored", and a key the schema does not describe "is never reported at any verbosity". A zod `z.object` strips such a key, so a misspelled setting, such as `state_dir` for `stateDir`, has no effect and writes no line, even at `-v`. Heimdall hit it: an operator who sees a setting have no effect runs `-v`, sees nothing, and concludes the setting was read. The `-v` line exists for that operator, and the misspelled key is the likelier cause of the two.

`z.strictObject` is no way out. zod reports the unknown key at the object's path, so the drop rule removes the whole object, and the whole file at the top level.

The plugin has no way to see an unknown key through Standard Schema, which reports issues and an output and no shape. Three sources were open: comparing the file's keys with the validated output's keys, the file's published JSON Schema under [ADR-0121](0121-the-configuration-source-publishes-its-files-json-schema-as-a-core-graph-fact.md), and the schema library's own shape. The owner agreed with the recommendation to walk the published JSON Schema. The link check already walks that schema to judge a `configInput` path, with a rule for when an object is open.

Whether an unknown key ever fails a run, in a strict mode, is LM-509's question. This record gives it one rule for which keys are unknown.

## Decision

- **Each unknown key is named at `-v`.** In every run that reads a configuration file, each key the file holds that the configuration schema does not describe writes one `out.debug` line, which shows at `-v` alone and never at the default verbosity. This supersedes ADR-0118's sentence that a key the schema does not describe is never reported at any verbosity. The default verbosity stays as quiet as ADR-0118 made it.
- **The published JSON Schema decides.** The plugin reads the graph's `configuration.schema`, which its `load` already receives on every run. It never compares the file with the validated output and never reads a schema library's own shape. A schema whose library publishes no converter, such as valibot's, and one whose converter fails, such as zod's for `z.bigint()`, publish `null`, and no unknown key prints a line under it.
- **The link check's rule, from the link check's code.** A key is unknown when the object that holds it is closed and does not list it, judged at each key exactly as the link check judges a link's key: a `$ref` into the schema's own `$defs` is followed, `allOf`, `anyOf`, and `oneOf` stand for each of their members, and the key is unknown when no shape lists it in `properties` and none of them is open, describes an array, or names no keyword but annotations. An open object, one with `additionalProperties` or `patternProperties` other than `false`, names nothing at its unlisted keys or below them, so a record, a loose object, and a section kept as `z.unknown()` flag nothing. For a path with no array item, a key is unknown exactly when a link to its path fails `link-path`. The implementation reuses the link check's walk rather than writing a second rule.
- **Array items are entered.** A link path holds no array index, so the link check never enters an array. The walk does: each item is judged against the `prefixItems` entry at its index, or else the `items`, of each shape that describes the array, so a misspelled key in a `[[sessions.sources]]` table prints. A shape that names neither takes any item.
- **The file as read, without its dropped values.** The plugin walks the file it read, less its top-level `$schema` key, and enters no value the drop rule removed, so a key at or below a dropped value prints no line of its own: the dropped-value line already names the value that holds it. An array item's index in the line is its position in the file as read.
- **The line.** `Ignored <path> in <file>: Unknown key. Check its spelling, or remove it.`, built as a dropped-value line is: the path's keys joined by dots, an array item as its index in brackets, the file as its labels show it, and each control character escaped. The sentence after the colon is fixed, because Loom writes it.
- **The order.** The lines follow every line the drop rule writes for a value the schema removed, in the order the parsed file lists its keys, depth first. The lines the source writes for a value a linked option cannot take, and the line core writes for a value a validator rejects, come after the plugin's `load` returns, so they follow these lines.
- **Nothing else changes.** An unknown key is no dropped value. The walk removes nothing from the file, so whether `provided.config` holds it stays the schema library's choice, it answers no link, and no exit code, warning, log event, or manifest field changes. The line is stderr text for the operator.

[Configuration plugin](../plugins/config.md#naming-unknown-keys) carries the contract.

## Considered options

- **Comparing the file's keys with the validated output's keys.** Rejected. The output is the library's value after its transforms: a transform that renames a key makes the file's key read as unknown, and a default adds keys the file never held. The JSON Schema describes the input the operator writes.
- **Reading the schema library's own shape, such as zod's `shape`.** Rejected. It works for one library alone, and Standard Schema exposes no shape.
- **Walking the file after the drop rule has passed it.** Rejected. An item removed before another moves that item's index, so the line would name an item the operator did not write there.
- **Walking into dropped values.** Rejected. A table the schema rejected as the wrong type would be judged against a shape that describes no object, and every key in it would print beside the dropped-value line that already names the table.
- **Judging an open object's unlisted keys against its `additionalProperties`, so a typo in a record's value prints.** Not taken. The link check leaves those keys unchecked, and one rule decides both, so the link check, this walk, and LM-509's strict mode cannot disagree on which key is unknown.
- **A warning at the default verbosity.** Rejected. ADR-0118's ruling that configuration files "just ignore unknowns" stands for the default verbosity, so an operator who never asks sees no new output.
- **Suggesting the declared key nearest the unknown one.** Not taken. The line names the key and the file, which is what the operator needs to find it.

## Consequences

The plugin's `load` walks the file once per read, after the drop loop, and only where a JSON Schema exists, so a run pays for one pass over the file it already holds. The link check and the walk share one judgment of a key. An application whose schema is valibot's, Loom's own `loom.config.json` included, prints no new line. The change adds `-v` output and changes no type, in a feature fragment of `@loomcli/plugins`.

ADR-0118's decision stands except the superseded sentence. Its considered option that rejected reporting unknown keys at `-v` is withdrawn, while its rejection of a warning stands. ADR-0118 carries a dated entry. ADR-0121 is unchanged: the walk reads the fact it publishes.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-14: Proposed with the contract for naming unknown keys (LM-516). It supersedes ADR-0118's sentence that a key the schema does not describe is never reported at any verbosity, and withdraws that record's rejection of reporting unknown keys at `-v`. ADR-0118 carries a dated entry.
