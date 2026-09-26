---
type: adr
title: ADR-0005 - Validation delegates to Standard Schema, with context passed through the standard's own channel
description: Core has no native validator and no validate hook. A value input accepts any Standard Schema object, and core passes a validation context on every call through the standard's libraryOptions record.
status: accepted
created: 2026-09-07
modified: 2026-09-25
---

# ADR-0005 - Validation delegates to Standard Schema, with context passed through the standard's own channel

## Context

Typed inputs are the point of the framework, and every application already has a schema library. A framework-native validator would be a second, weaker type system that authors must learn and core must maintain.

A value option or argument accepts a `validate` property holding any [Standard Schema v1](https://standardschema.dev/) object. Core calls the standard interface directly, awaits synchronous or asynchronous results, and takes the schema's output type as the action's value type. A compatible library needs no adapter or plugin, and core re-exports the `StandardSchemaV1` type so a hand-written validator depends on `@loom/core` alone.

Some input rules depend on the invocation, such as "a file path, or piped stdin when no path is given". Core passes a `ValidationContext` on every schema call through the standard's `libraryOptions` record under `validationContextKey`, and `validationContext(options)` reads it back. The context carries the phase, the input's identity, the routed path, the passthrough tail, the raw supplied tokens, and the host. A library that ignores the argument, such as Zod, is unaffected.

## Considered options

- **A `validate()` authoring call that returns issues.** Rejected. It grows framework surface, has no inferred output type, and duplicates what every schema library already does.
- **A non-standard second argument to the schema.** Rejected. The standard already defines an open record for library options, so using it keeps every conforming library compatible without a wrapper.
- **Per-item schemas for collections.** Rejected. A multiple option or variadic argument passes its whole `string[]` to one schema, which can validate items, enforce collection rules, or transform the shape. Per-item schemas fork the default rule and leave list-level rules with no home.

## Consequences

Boolean options accept no schema; their polarity decides their absent value. A schema that throws or returns a malformed result is a declaration error with exit 1, because only a returned issue states a validation verdict.

## Changelog

- 2026-09-08: The core package is named `@loomcli/core` before its first publication. References to `@loom/core` above name the same library. The architectural decision is unchanged.
- 2026-09-24: [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md), proposed, widens what the validation context calls supplied. An option the environment or the configuration source filled is supplied, and `supplied` holds the raw value that tier filled: the string, the Boolean, or the list. The schema receives the same value, and the context names no tier. It binds when that record is accepted.
- 2026-09-25: [ADR-0036](0036-a-collected-inputs-validator-validates-one-item.md), proposed, supersedes the considered option that rejected per-item validators for collections. On a multiple option or a variadic argument, `validate` names the validator for one item, a default passes item by item, and a rule over the whole list belongs to the action. It binds when that record is accepted; the rest of this record is unchanged.
