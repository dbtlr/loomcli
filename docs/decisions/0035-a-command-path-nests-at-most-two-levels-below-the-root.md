---
type: adr
title: ADR-0035 - A Command path nests at most two levels below the root
description: A routed path holds at most two Command names below the root, so `app a b` is valid and `app a b c` is a declaration error. The cap is an internal constant rather than a public option, so raising it later relaxes a rule and breaks no application.
status: proposed
created: 2026-09-25
modified: 2026-09-25
---

# ADR-0035 - A Command path nests at most two levels below the root

## Context

The core reference stated that a graph nests to any depth and that children attach at any depth. No record decided it. It followed from `command()` being available on every named Command.

Depth has costs. An operator cannot discover or remember a path three or more names deep. Every walk over the graph, in validation, routing, help, the manifest, and completion, must handle any depth, and a projection's layout must hold for trees no example exercises. [ADR-0034](0034-a-declaration-fault-throws-at-the-earliest-point-that-knows-it.md) moves structural checks to attach, where a bounded depth keeps the check local: a parent can tell from a child alone whether the child fits.

## Decision

- **The cap.** A Command path reaches at most two levels below the root. A child of the root is at level 1 and its child is at level 2, so `app a b` is valid and `app a b c` is a `DeclarationError`.
- **Plugin Commands.** A plugin's Commands are ordinary root children under ADR-0033 and count at level 1.
- **When it throws.** The cap throws at the earliest attach that shows it, under ADR-0034. A child taller than its parent can hold at the parent's shallowest possible level, level 0 for the root and level 1 for a named Command, fails at the `command()` call that attaches it. For `Application.command()` the root's level is known, so the same check is final when the subtree joins the Application. With a cap of two, a named parent can hold only a Command with no children, so every violation throws at a `command()` call.
- **An internal constant.** The value is a constant inside core, not an Application or Command option.

## Considered options

- **Unlimited depth.** Rejected. Deep paths make an application hard to use, and every validation and projection walk carries unbounded work.
- **A public, configurable cap.** Rejected. It is a second way to shape one job, and every projection must still handle any depth.
- **A fixed internal constant.** Chosen. Raising it later relaxes a rule, which breaks no application.

## Consequences

An application that nests three or more levels deep fails at its first `command()` call that shows the fault. That is a breaking change, and the implementation records it with its migration: attach the deepest group to a shallower parent or flatten its children. Both example applications and the repository's `loom` tool nest two levels at most.

## Status

Proposed. It moves to accepted when the implementation lands and `command()` rejects a Command that would sit more than two levels below the root.
