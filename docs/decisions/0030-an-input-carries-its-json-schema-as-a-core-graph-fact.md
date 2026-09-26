---
type: adr
title: ADR-0030 - An input carries its JSON Schema as a core graph fact, derived through the Standard JSON Schema channel
description: Graph build asks a validated input's Standard Schema for its input-side JSON Schema through the standard's converter and stores the plain result on the option or argument node, so the manifest, help, completion, and any later projection read one shape fact with no plugin installed. A result carries no schema.
status: proposed
created: 2026-09-18
modified: 2026-09-25
---

# ADR-0030 - An input carries its JSON Schema as a core graph fact, derived through the Standard JSON Schema channel

## Context

The manifest is the projection an agent reads to construct a correct invocation without a validation-driven retry, and its most valuable line on an input is what the input accepts. Today the graph records only that an input is validated. The schema object itself stays private to `inspect()` under ADR-0010, and the hook surface a plugin receives at `onCommandAttach` lists input names alone, so no plugin can reach a validator to ask it for a shape. The help page has the same gap: textstat's `--metric` row prints a placeholder while the accepted set `bytes, words, lines` exists only in the validation error.

`@standard-schema/spec` 1.1.0, which core already depends on for validation under ADR-0005, defines `StandardJSONSchemaV1`: a converter beside `validate` with an `input` and an `output` method, each taking a target draft and returning a plain JSON Schema object, and each permitted to throw when the schema cannot be represented. zod 4 implements it. The channel needs no zod dependency in core and no Loom vocabulary for constraints.

Graph build asks every validated option and argument whose schema implements the converter for its input-side JSON Schema and stores the result, frozen to any depth as plain data, on the node under `schema`. An unvalidated input, a validator without the converter, and a converter that fails all read `null` under `run()`, so a projection that finds `null` says the shape is unknown rather than unconstrained; whether a failing converter is also a diagnostic is settled in the contract. `inspect()` publishes the field. Validation is unchanged: core still runs the schema's `validate` on every call, and the stored JSON Schema changes no run-time behavior.

The governing principle is that the graph is the source of truth and the manifest is one projection of it. Nothing depends on the manifest. A fact an agent needs enters the graph, and from there it reaches the manifest, the help page, a completion script, and a later tool listing alike. That is the test ADR-0019 set for a core fact, that every projection reads it with no plugin installed, and the input's shape meets it more clearly than `deprecated` did.

Every CLI input arrives as a string token. The projected schema describes the value that token must satisfy, so a coerced number projects as `integer` with its bounds and an enum projects as its literals. A projection states this rule once and never per input.

A result carries no schema. A declared result schema is work no author will write, and a schema declared beside the formatter's `map` would have to describe the mapped document or it would be a false promise. The manifest states what the graph holds about a result, its unit and its view names, and an agent learns the document's shape from one run.

## Considered options

- **The manifest plugin computes the shape at `onCommandAttach` and stores it under its own descriptor.** Rejected. Core would have to expose live schema objects to hooks, which ADR-0010 keeps private, and help, completion, and every later projection would import the manifest's descriptor to read a fact that is not the manifest's. That is a dependency on the manifest.
- **A closed Loom constraint vocabulary carried on the schema value.** Rejected. The standard channel already produces a JSON Schema every consumer can read, a schema library implements it once for every framework, and a Loom vocabulary would be a second, weaker description that every validator author must maintain.
- **An optional schema on `result()` and `rows()`.** Rejected, as above. The LM-84 ruling that the result declaration carries a type and no schema stands.
- **Projecting the output side of the converter.** Rejected. The output type is the action's value after transformation, which ADR-0005 makes the action's business, and the manifest documents what a caller supplies.

## Consequences

`OptionNode` and `ArgumentNode` gain `schema`, a plain read-only object or `null`, and the addition is a type-surface change with a change fragment. Build takes a dependency on the converter's behavior, bounded by the spec's contract that it is synchronous and may throw. Which JSON Schema target build requests and whether a converter throw is silent or a build diagnostic are settled in the contract this record binds. The help page reads the fact to print an option's accepted values when the schema is a flat enum of strings, and the manifest copies it verbatim.

## Status

Proposed. It moves to accepted with the contract in `docs/core.md` and the implementation that stores the fact and publishes it through `inspect()`.

## Changelog

- 2026-09-19: The contract in `docs/core.md`, under Input schema, binds the two open choices this record left to it. Build requests target `draft-2020-12` with no `libraryOptions`, and stores the converter's input-side return value verbatim, copied and frozen, reading nothing inside it. A converter that throws or returns anything other than a plain object is a `DeclarationError` from `inspect()`, naming the input, the target, and the converter's message, and reads `null` under `run()`, because an operator cannot correct an author's schema: the diagnostic belongs to development and the unknown shape to a shipped application. `null` has one reading, no published shape, and never means unconstrained. The Boolean `OptionNode` variant carries `schema: null` as well, so the node shape holds if a later contract lets a Boolean option validate. Two facts the contract records: zod 4.5.4's converter does not throw on a transform's input side, so no existing application meets the new error, and the formatter's `--format` validator moves its accepted names ahead of the `ndjson` mapping so the fact carries the enum. The authored human sentence for a help row is a help descriptor field for the help accepted-values contract, not a core fact. This amends the ADR-0010 statement that `inspect()` applies every rule `run()` applies but one: the converter check is the one rule `inspect()` applies that `run()` does not, and the two now differ in both directions. The record stays proposed until the implementation stores the fact and `inspect()` publishes it.
- 2026-09-19: The implementation stores the fact and `inspect()` publishes it. Every `ArgumentNode` and both `OptionNode` variants carry `schema`, the converter's input-side answer for `draft-2020-12` copied and frozen to every depth, one call and one copy per validated input, on every `inspect()` call and on every run with a middleware chain; `@loomcli/core` exports `StandardJSONSchemaV1`, and the formatter's `--format` validator maps `ndjson` ahead of the enum of the view names. One rule of the entry above is held: the owner reopened the converter-failure diagnostic, because a `DeclarationError` from `inspect()` alone reaches a test harness and no developer running the application through `run()`. Until the question of how a run tells a development application from a distributed one is decided, a converter that throws or returns a non-object reads `null` under `inspect()` and `run()` alike, and the two paths differ in one direction only; the dated entry of the same day on ADR-0010 withdraws the second exception for as long as the rule is open. The record stays proposed until that rule is settled.
- 2026-09-24: [ADR-0031](0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md), proposed, keeps this record's principle that nothing depends on the manifest and states its meaning: no projection, plugin, or core path reads a fact from the manifest. A plugin may still supply its own facts to the manifest through the manifest's collecting extension, and those facts stay on the graph for every other projection.
- 2026-09-24: The help accepted-values contract in [Accepted values](../core.md#accepted-values) widens the help change this record's Consequences describe from a flat enum of strings to any closed set of strings the schema publishes, an `enum`, a `const`, or an `anyOf` of them, at the top level or under `items`, up to eight values, with an authored `accepts` line taking precedence.
- 2026-09-25: [ADR-0036](0036-each-value-passes-the-same-validator.md), proposed, makes the validator of a multiple option or a variadic argument check one value. Its input schema is then the validator's own, unchanged, rather than a schema of the whole `string[]`, and the node's `multiple` or `variadic` flag says the input takes several values. Core still writes nothing into the fact. It binds when that record is accepted.
