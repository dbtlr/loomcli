---
type: adr
title: ADR-0013 - Core installs no plugins by default, and contributions compose first-in-wins with single-owner slots
description: Every capability beyond core, first-party included, is an ordinary plugin an Application installs explicitly. There is no deregistration. Composable contributions resolve first-in-wins in installation order with core defaults last, and a second claim on a single-owner slot fails compilation.
status: proposed
created: 2026-09-07
modified: 2026-09-08
---

# ADR-0013 - Core installs no plugins by default, and contributions compose first-in-wins with single-owner slots

## Context

Help, version, manifests, completions, and agent projections all sit outside the core contract. The question is whether some of them are privileged.

They are not. Core installs nothing by default and offers no disable or deregistration. Every first-party capability ships as an ordinary plugin that an Application installs explicitly through the same public extension contract a third-party plugin uses. Replacing a first-party behavior means omitting one implementation and installing another.

Where contributions compose, they resolve first-in-wins: caller-supplied facts, then plugins in installation order, then core defaults as the trailing fallback. A second claim on a single-owner slot is an invariant violation and fails compilation. Duplicate plugin identities fail compilation. Contribution names sit inside the declaring plugin's namespace.

## Status

Proposed. Milestone 1 ships no plugin contract, so no code exercises this decision yet. It records the shape the first plugin increment must honor, and it moves to accepted with the code that enforces it.

## Considered options

- **Implicit help and version plugins.** Rejected. A bundled layer is a second extension surface with privileges a third party cannot get, and removing it needs a deregistration path.
- **Privileged first-party branches in core.** Rejected for the same reason: one contract for every plugin, or the contract is not the contract.
- **Plugin-reorderable precedence.** Rejected. Installation order is visible in the application source; a precedence system is not.

## Consequences

An application that wants help output installs the help plugin. Core stays small and host-independent, and the plugin contract is designed once for every consumer.

## Changelog

- 2026-09-08: The contract that honors this record is shaped in the plugin section of `docs/core.md`. A plugin is a frozen value with an identity fixed at definition, installed through the `plugins` list on the Application options in composition order. Its contribution kinds are plugin options, which share the globals table but reach no action, one middleware with declared activation and a loader, extension values, failure renderers, and one claim on the signals slot. Three records carry the decisions that go beyond this one: ADR-0017 for the middleware chain and activation, ADR-0018 for cancellation and the signals slot, and ADR-0019 for descriptor-keyed extension values and the core-owned `description` and `version` facts. Three refinements to the wording above: a first-party plugin identity is the package name by convention; the namespace sentence applies to extension identities, which a plugin names under its own identity, rather than to option spellings, which share one table with the application's globals and fail on collision; and "fails compilation" above means graph build, the same surface every other declaration rule uses, because a duplicate identity and a second slot claim are facts of the installed list that the type system does not see. A fact whose plugin is not installed is inert rather than an error. The decision is unchanged, and these refinements bind with the records that carry them.
