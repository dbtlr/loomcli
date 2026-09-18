---
type: adr
title: ADR-0030 - An input carries its JSON Schema as a core graph fact, derived through the Standard JSON Schema channel
description: Graph build asks a validated input's Standard Schema for its input-side JSON Schema through the standard's converter and stores the plain result on the option or argument node, so the manifest, help, completion, and any later projection read one shape fact with no plugin installed. A result carries no schema.
status: proposed
created: 2026-09-18
modified: 2026-09-18
---

# ADR-0030 - An input carries its JSON Schema as a core graph fact, derived through the Standard JSON Schema channel

## Context

The manifest is the projection an agent reads to construct a correct invocation without a validation-driven retry, and its most valuable line on an input is what the input accepts. Today the graph records only that an input is validated. The schema object itself stays private to `inspect()` under ADR-0010, and the hook surface a plugin receives at `onCommandAttach` lists input names alone, so no plugin can reach a validator to ask it for a shape. The help page has the same gap: textstat's `--metric` row prints a placeholder while the accepted set `bytes, words, lines` exists only in the validation error.

`@standard-schema/spec` 1.1.0, which core already depends on for validation under ADR-0005, defines `StandardJSONSchemaV1`: a converter beside `validate` with an `input` and an `output` method, each taking a target draft and returning a plain JSON Schema object, and each permitted to throw when the schema cannot be represented. zod 4 implements it. The channel needs no zod dependency in core and no Loom vocabulary for constraints.

Graph build asks every validated option and argument whose schema implements the converter for its input-side JSON Schema and stores the result, frozen to any depth as plain data, on the node under `schema`. An unvalidated input, a validator without the converter, and a converter that throws all read `null`, so a projection that finds `null` says the shape is unknown rather than unconstrained. `inspect()` publishes the field. Validation is unchanged: core still runs the schema's `validate` on every call, and the stored JSON Schema changes no run-time behavior.

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
