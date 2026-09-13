---
type: adr
title: ADR-0026 - Applications declare global options through a fluent method
description: Application.globalOption declares shared inputs directly and closes before Command attachment or action registration, preserving automatic global type propagation.
status: accepted
supersedes: ADR-0024
created: 2026-09-13
modified: 2026-09-13
---

# ADR-0026 - Applications declare global options through a fluent method

## Context

Application ownership needs one place to declare shared options. A separate `GlobalOptions` object adds a declaration container and constructor wiring without adding a capability. The Application already supports immutable, typed option declarations.

## Decision

`Application.globalOption(name, config)` declares a global option directly. It takes the same option configuration as `option()`, including spelling, defaults, validation, repeated values, core facts, and option-targeted extensions. Each call returns a new Application and adds the schema output type to its globals. The receiver stays unchanged.

The SDK exports no `GlobalOptions` class or type. Application and Command constructor options carry no `globals` property. Constructor type parameters cannot declare global output types. Application constructor inference retains plugin tuples; `ApplicationOptions` takes only its optional plugin tuple type parameter.

Declare globals before the first `command()` or `action()` call on the Application. Both calls remove `globalOption()` from the returned type. Graph build rejects late global declarations for JavaScript callers. `extend()` preserves this restriction. Root-local options and globals cannot share a key in either declaration order; attachment checks imported Command local keys against the completed global types. This order avoids retaining every attached child's input types just to check later globals.

Register `EnvironmentOf<typeof configured>` once, after the global declarations and before Command attachment or action registration. Standalone Commands and extracted actions receive the global output types automatically. The Application's own action derives those types directly from the fluent declarations. Its private input list and typed binder supply global values during invocation; no separately authored public container is involved.

This decision supersedes ADR-0024 only for global declaration syntax, constructor globals inference, and the runtime declaration container. All other provisions of ADR-0024, including its incorporation of ADR-0003's invocation and collision rules, remain in force. The environment registration boundary, library isolation, plugin tuple propagation, and immutable Command extension behavior are unchanged.

## Verification

The declaration harness checks automatic types across modules and packed library boundaries, schema outputs, immutable derivation, literal names, collisions, and method closure. Runtime tests check globals at detached actions, unchanged receivers, both late declaration cases through `inspect()` and `run()`, and unchanged parser and help behavior under Node and Bun.
