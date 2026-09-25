---
type: adr
title: ADR-0034 - A declaration fault throws at the earliest point that knows it
description: A declaration fault throws from the authoring call, constructor, or attach that first holds the data proving it, and only a declaration a later step may still add to waits for graph build. It supersedes the clause that graph build repeats the authoring rules for JavaScript authors.
status: proposed
created: 2026-09-25
modified: 2026-09-25
---

# ADR-0034 - A declaration fault throws at the earliest point that knows it

## Context

Authoring calls collect declarations, and graph build validates them during `run()` and `inspect()`. The convention comes from ADR-0001's clause that graph build applies the authoring rules to JavaScript authors, which ADR-0025 carries forward. No record states why a fault waits for build, and the wait has two costs. A JavaScript author learns of a bad call from `run()`, with a stack inside core and far from the offending line. And because `command()` accepts any value and build checks it later, a Command stores its attached children as `object` values rather than as typed Commands.

Most faults are known at the call. `option('verbose', { type: 'boolean', multiple: true })` is wrong when it is called, and no later call can make it right. A Command is an immutable value under ADR-0025, so a child that `command()` attaches can change no further, and its own contract is final at that moment. Only two things are incomplete at a call: the root, which later calls on the Application can still extend, and the graph that lifecycle hooks still add to at build.

TypeScript rejects most of these faults at the call site already. The runtime guards exist for values that bypass the types, from JavaScript or through `any`. A guard that runs where the type check would have run reports the fault where the author looks for it.

## Decision

A declaration fault throws `DeclarationError` at the earliest of three moments that holds the data proving it. Each guard runs at the top of its function, before any side effect, and every existing diagnostic keeps its text, except the invalid Command name, which `new Command()` raises before any parent exists; the nesting cap adds one row.

- **At the call.** Every authoring call, both constructors, and `plugin()` throw from the call for a fault in their own input: a value of the wrong shape, an invalid name, a validator that is not a Standard Schema, an invalid option configuration, a retired slot, and a `views` entry that is not an override. They also throw for a fault the receiver's earlier calls make certain: a declaration after `action()`, a second action, a result declared out of order, arguments beside children, a variadic argument that is not last, an optional argument before a required one, an alias repeated on one Command, and a global option declared after composition starts. `new Application(name, { plugins })` validates the plugin list at construction: an identity installed twice, the signals slot, the theme slot, or the configuration source claimed twice, and two plugins' options that collide.
- **At attach.** One attach operation serves `Command.command()`, `Application.command()`, and a plugin definition's `commands` list. An attached Command is final, so attach checks it as a finished Command: it has children or an action, a group declares no local option, a result has an action, and its merged views record holds at least one view and a `default` that names one of them. `views()` stays callable and can add keys, so the last two are incomplete at the call. Attach checks the child's name and aliases against the parent's current children. A plugin's Commands join the root when the Application is constructed, first, as ADR-0033 orders them, so the application's own root attachments check against them. Attach stores the child as a typed handle. When a subtree joins an Application, the Application walks it once for the rules only it can judge: a local option that collides with a global option or a plugin option, a variable that a global or plugin option and a local option both bind, two distinct descriptors that share an identity across the subtree and the Application, one Command value reached through two paths, and the nesting cap of [ADR-0035](0035-a-command-path-nests-at-most-two-levels-below-the-root.md) measured from the root.
- **At build.** `run()` and `inspect()` throw only for what no earlier moment could know: the root's finished-Command checks, because the root is never attached and build is the first point at which it is final; a lifecycle hook that fails; and a fault in what a hook contributes. A value a hook passes to `extend()` is still validated at that call.

A declared default that its schema rejects stays a `run()` fault, because the schema may answer asynchronously.

This record supersedes the clause of ADR-0025, carried from ADR-0001, that graph build applies the order rules to JavaScript callers. It also supersedes the matching timing clauses of ADR-0002, ADR-0004, ADR-0010, ADR-0018, ADR-0022, ADR-0026, and ADR-0033, the ADR-0019 clause ADR-0025 carries, and the ADR-0024 clause ADR-0026 carries, each named in a dated entry on the record that states or carries it. Every rule those records state still holds, and only the moment it throws moves.

## Considered options

- **Keep collecting declarations and validate them at build.** Rejected. It has no recorded rationale, it reports a fault far from the line that caused it, and it forces untyped storage of attached children.

## Consequences

A JavaScript author's bad authoring call throws when its module evaluates, usually at import, with a stack at the offending line, instead of being reported from `run()` or `inspect()`. A fault that throws before `run()` is an uncaught exception in the author's module: no failure view renders it and core sets no exit code. A build fault is reported as before, a diagnostic with exit 1 from `run()` and a thrown `DeclarationError` from `inspect()`.

[Declaration faults](../core.md#declaration-faults) in the core reference names the moment of every rule, and the rule tables keep their diagnostics.

## Status

Proposed. It moves to accepted when the implementation lands: each authoring call, constructor, and attach throws the faults the contract assigns to it, attached children are stored as typed Commands, and graph build applies only the rules the contract leaves to it.
