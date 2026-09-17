---
type: adr
title: ADR-0029 - Explicit color fallbacks preserve theme hues
description: Extend concrete color helpers with optional depth-specific fallbacks while core retains capability detection, composition, and rendering policy.
status: proposed
created: 2026-09-17
modified: 2026-09-17
---

# ADR-0029 - Explicit color fallbacks preserve theme hues

## Context

Core approximates custom colors by squared RGB distance when a destination lacks the requested depth. That preserves numerical proximity but can lose a semantic hue. With the Loom palette, the current resolver maps sage success to bright black at both 16 and 256 colors. At 16 colors, woad info becomes bright black and madder error becomes yellow.

A theme must be able to preserve those hues without reading terminal facts or installing middleware. The theme still contributes one static mapping, and core still resolves its colors for the destination.

## Decision

The existing `hex`, `rgb`, and `ansi256` helpers and their background counterparts accept optional fallback values. RGB and hex accept `ansi256` and `ansi16`. ANSI-256 helpers accept only `ansi16`. The [core reference](../core.md#explicit-color-fallbacks) defines the types, selection rules, and validation.

Each fallback affects only its named depth. When a fallback is absent, core approximates the original color at that depth. Supplying a 256-color fallback never changes the 16-color result. Calls that omit the options argument retain their current output. Direct array callbacks also receive an index, so `values.map(style.hex)` must become `values.map((value) => style.hex(value))`. The index now occupies a validated options position.

Fallbacks are part of the concrete color value. Replacing that foreground replaces all its alternatives. Nesting and embedded resets restore the enclosing color with its alternatives. Core's capability detection and color policy decide which value reaches the stream. Explicit fallbacks do not force color.

The [Loom theme](../core.md#loom-theme) supplies the dark foreground palette with deliberate reduced-color values. It leaves terminal backgrounds and inherited modifiers unchanged. `primary` uses terminal default foreground. A view adds bold or other modifiers explicitly. Light colors and automatic background detection are deferred.

`loomTheme(overrides?)` supplies all seven defaults, accepts whole-token replacements and custom keys, and shares the bare factory's subpath and identity. Its type suggests the fixed keys while retaining inferred custom names. An omitted or undefined built-in override retains its default. The existing empty chain and scoped resets express inheritance and clearing without a new sentinel.

## Relationship to accepted decisions

When accepted, this record supersedes only the unconditional approximation rule incorporated by ADR-0027 through the core reference. An explicit fallback takes precedence at its named depth. All other ADR-0027 constraints remain: core owns resolution, the theme is a static concrete mapping, and one optional plugin owns the theme slot. ADR-0022 continues to govern the proposed named palette and its acceptance gate.

The new color forms are specified in the [wire contract](../style-wire.md#explicit-color-fallbacks-proposed). Existing forms remain valid. The wire remains internal and is not a persistent interchange format.

## Considered options

- **Approximation alone.** Rejected for the named palette because semantic green, blue, and red can become gray or yellow.
- **Capability checks inside the theme.** Rejected because construction must remain independent of a run and its destinations.
- **A separate color helper.** Rejected because existing helpers can carry options without reserving another name against custom tokens.
- **Cascading fallback approximation.** Rejected because changing a 256-color setting would also change the 16-color result.

## Status

Proposed. One implementation increment delivers the named palette and fallback helpers together, then accepts this record and ADR-0022 together. The two acceptance lists in the core reference are checks within that shared delivery gate, not independent shipping increments. Packed-consumer evidence and Node and Bun process fixtures cover both. The acceptance cases in the core reference include autocomplete and literal-name inference, exact colors at each depth, composition, validation, and unchanged no-options behavior. Until that implementation lands, current exports and approximation remain governed by ADR-0027.

## Changelog

- 2026-09-17: Proposed explicit color fallbacks and the foreground-only named palette.
