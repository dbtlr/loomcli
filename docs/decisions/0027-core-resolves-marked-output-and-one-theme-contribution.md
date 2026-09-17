---
type: adr
title: ADR-0027 - Core resolves marked output and one theme contribution
description: Accept the implemented style seam independently of the proposed named Loom palette, replacing the affected renderer and plugin-slot clauses.
status: accepted
created: 2026-09-13
modified: 2026-09-17
---

# ADR-0027 - Core resolves marked output and one theme contribution

## Context

ADR-0022 describes the style seam and a named Loom palette. Its acceptance gate includes that palette, which is a separate increment. The implemented seam needs an explicit replacement for two accepted constraints before the palette arrives.

## Decision

Core resolves ordinary marked strings for their destination. A pure synchronous Renderer receives its value and an immutable context with `style` and `width`. It returns text with its own newline. Core resolves style spans, glyphs, deferred padding, and embedded ANSI under the Application's rendering policy before writing.

The [core reference](../core.md#styles-and-rendering-policy) specifies the public catalogs, captured capability facts, policy precedence, Unicode measurement, and literal-data escaping. The [wire contract](../style-wire.md) specifies framing and resolution. These contracts govern the implemented seam independently of ADR-0022's named palette.

One optional plugin contributes a mapping from semantic names to unapplied concrete styles. A second theme contribution is a declaration error. The bare `theme(mapping)` factory uses the public contribution and the identity `@loomcli/plugins/theme`. Core installs no theme. Custom names flow through the shallow Application environment registration governed by ADR-0026.

The semantic methods retain their string-only signatures and append one newline. `print` is prefix-free. `info`, `success`, `warn`, and `error` add their matching glyph and one space. Continuation lines align after that measured gutter without repeating the glyph.

This decision supersedes only ADR-0008's value-only renderer input, exact-byte output, and exclusion of terminal styling from core. Renderer purity, neutral output, newline ownership, destination ordering, and failure accounting remain in force.

It also supersedes ADR-0007's exact-byte promise for working failure renderers. Failure renderers return marked text resolved for stderr. Class-keyed registration, precedence, exit codes, and plain fallback behavior remain unchanged.

For ADR-0020, this decision supersedes the prohibition on an exclusive theme slot and the unconditional requirement for a middleware module. A plugin that contributes middleware loads it lazily; a mapping-only theme needs no middleware. Other packaging rules remain in force, including separately installable subpath exports. ADR-0009's whole-field Host overrides remain unchanged: rendering policy is a separate options block with field-wise invocation overrides.

## Consequences

Renderers escape raw marker-bearing data with `style.escape()` while preserving authored marked messages. Existing one-argument renderers remain type-compatible. Embedded ANSI is subject to policy, so exact-byte consumers must review the migration instructions.

The named `loomTheme` palette remains proposed under ADR-0022. The view registry and results lane remain proposed under ADR-0021 and ADR-0023. This decision adds none of their registration or routing APIs.

## Changelog

- 2026-09-13: Accepted the implemented style seam separately from the named palette.
- 2026-09-13: Scoped the resource guarantee to linear framing and cached analysis for unchanged nested padding. Arbitrary nesting that changes content at every level can still require quadratic Unicode measurement and transient allocation. Removing that pathological cost is a separate performance increment and does not gate this seam.
- 2026-09-14: The view registry contract in [Views](../core.md#views) renames `Renderer` to `View` and `RendererContext` to `ViewContext`, and makes the semantic methods' glyph gutter the default of a lane view that an application can override, binding when [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) is accepted. The semantic method still appends its one newline outside the view. Every other clause stands.

- 2026-09-14: ADR-0021 is accepted and the view registry is implemented; the sentence above that calls it proposed predates that acceptance. The results lane remains proposed under ADR-0023, whose contract in [Results](../core.md#results) adds the row view as a second shape of the marked-string view this record defines, with no change to the string, theme, or resolution seam.
- 2026-09-17: [ADR-0029](0029-explicit-color-fallbacks-preserve-theme-hues.md) proposes an exception to the incorporated approximation rule: an explicit color fallback takes precedence at its named depth. Existing no-options behavior and every other constraint remain unchanged. This exception binds only when ADR-0029 is accepted with its implementation.
