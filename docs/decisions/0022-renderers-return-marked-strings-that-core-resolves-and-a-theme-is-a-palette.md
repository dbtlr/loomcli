---
type: adr
title: ADR-0022 - Renderers return marked strings, and a theme maps semantic names to concrete styles
description: Ordinary strings carry composable terminal styles, semantic tokens, glyphs, and deferred padding. Core resolves them under one rendering policy, and one optional theme plugin supplies concrete token mappings.
status: proposed
created: 2026-09-11
modified: 2026-09-12
---

# ADR-0022 - Renderers return marked strings, and a theme maps semantic names to concrete styles

## Context

A renderer does not own its destination or know the terminal's capabilities. If each renderer emits final escape bytes, capability detection and output policy diverge between renderers. Core must resolve the presentation for the destination while preserving ordinary string composition.

A style call therefore returns an ordinary marked string. It works through interpolation, concatenation, and `join()` without a separate text type. Direct terminal colors and modifiers compose independently. A semantic token can supply either or both. Chains apply left to right, nested spans restore their enclosing attributes, and scoped resets make explicit clearing possible.

Private-use characters are legal data. They make markup uncommon in ordinary text, not impossible. Normal style calls retain existing markup so nesting works. `style.escape()` is the explicit literal-data escape; it adds no style. The [wire contract](../style-wire.md) specifies recognized frames, literal unmatched delimiters, and malformed input. First-party renderers escape raw data values while preserving authored marked messages.

Core supplies `style` to actions and a second immutable renderer context with `style` and destination-aware `width()`. Renderers remain pure and synchronous, take no output handle, and return strings with their own trailing newline. `pad()` also returns marked text and defers spaces until core resolves glyph forms. Measurement uses terminal columns, including combining marks, wide characters, emoji sequences, and eight-column tab stops.

A theme is one explicitly installed plugin mapping semantic names to concrete style chains. `theme()` supplies a bare mapping, and `loomTheme()` supplies Loom defaults with whole-token overrides. Both are constructors for the same plugin at `@loomcli/plugins/theme`. Future named themes use the same public contribution contract. Mapping values cannot reference tokens. Omitted mappings inherit the surrounding style. Core installs no theme; direct terminal styles remain available without one.

Custom names come directly from theme configuration. There are no token descriptors, style groups, record-specific namespaces, or theme references on individual Commands. One Application-owned type registration carries the derived names to independent Command modules and renderers. The shallow Application environment excludes the completed command tree so handlers do not create circular inference. Restoring that general type foundation precedes this feature's implementation; this record does not replace it with another authoring mechanism.

The core glyph inventory follows the pinned [Inquirer figures catalog](../glyphs.md), including its compatibility fallbacks and semantic aliases. Compatibility is not an ASCII-only promise. Every glyph is unstyled, and glyph selection is independent of theme, color policy, and redirection. A renderer explicitly styles any glyph it uses.

Application and invocation options contain `rendering`. One policy covers both streams; automatic capability detection evaluates each destination separately. Invocation overrides replace only supplied policy fields. `color`, `modifiers`, and `hyperlinks` accept `auto`, `always`, or `never`. `terminalControls` accepts `strip` or `preserve`, with stripping as the default. Policy describes desired output; Host describes captured facts.

Explicit policy takes precedence over environment defaults. Nonempty `FORCE_COLOR` wins over nonempty `NO_COLOR`; either treats `"0"` as nonempty. Numeric forcing values do not select color depth. `NO_COLOR` suppresses foreground and background colors, including embedded ANSI colors, without removing modifiers or hyperlinks. General terminal controls and hyperlinks have independently configurable policies. ANSI resets restore enclosing Loom styles instead of breaking composition.

The [core reference](../core.md#styles-and-rendering-policy-proposed) defines the inventories, public syntax, detection rules, degradation, and acceptance cases. A lane renderer receives the original message string and owns its gutter and continuation layout. No structured multiline message type is introduced.

## Considered options

- **A separate styled-text value.** Rejected. It disrupts ordinary strings without adding a needed renderer capability.
- **Tokens limited to colors.** Rejected. Theme authors need to define complete semantic appearances, including modifiers.
- **Automatically colored glyphs.** Rejected. Glyph identity and theme appearance are independent choices.
- **Public token descriptors and style groups.** Rejected. A flat, inferred Application vocabulary removes the extra registration and override syntax.
- **Theme mappings that reference other tokens.** Rejected. Concrete mappings avoid dependency ordering and cycles while allowing shared concrete constants.
- **Manual theme propagation into each Command.** Rejected. Application types must flow automatically through the existing intended registration model.
- **Several installed themes composed first-in-wins.** Rejected. Exactly one plugin owns the theme mapping; named defaults and overrides belong to that contributor.
- **Unconditionally removing terminal controls.** Rejected. Authors need a supported exception for output that intentionally controls the terminal.
- **Separate policy configuration for stdout and stderr.** Rejected. One policy is sufficient; detection remains destination-specific.

## Relationship to accepted decisions

When accepted, this record supersedes ADR-0008's requirements that a renderer receives its value alone, produces exact output bytes, and keeps terminal styling outside core. The replacement is a pure renderer with a supplied context whose returned text core resolves. Neutral output, renderer-owned newlines, fixed semantic call shapes, output ordering, and failure handling remain unchanged.

When accepted, this record also supersedes ADR-0020's prohibition on a plugin-pack theme claiming an exclusive slot. A single theme owner is now a core invariant, with a second claimant rejected at build. Both pack factories construct that one plugin, so they share a subpath and identity rather than introducing bundled sibling plugins. Other plugins remain separately installable under ADR-0020.

ADR-0009's whole-field Host override rule remains unchanged. Rendering policy is a separate options block with a field-wise merge. ADR-0019's rejection of plugin-named config fields remains unchanged. Application-owned type registration is not plugin augmentation of a core config catalog.

## Status

Proposed. The API is an implementation target, not a claim about current exports. This record moves to accepted after the automatic type-propagation prerequisite, the style implementation, and the named Loom theme land with packed-consumer and Node/Bun evidence. The exact-byte and plugin-slot replacements above bind at that transition. The code remains governed by the current accepted records until then.

The view registry and results lane remain separate increments under ADR-0021 and ADR-0023. This contract supplies their string, theme, and resolution seam without implementing their registration APIs.

## Changelog

- 2026-09-11: Recorded the initial proposed marked-string and theme-palette direction.
- 2026-09-12: Replaced the initial proposal with the style contract. Tokens can combine colors and modifiers; themes use flat inferred names; glyphs are independent and retain upstream compatibility forms. Added ordinary-string composition, explicit escaping, scoped resets, destination-aware width, deferred padding, embedded ANSI handling, and configurable rendering policies. Removed the paired-token, strict-ASCII, descriptor-group, and mandatory automatic-escaping proposals. Recorded the pending replacements of the affected ADR-0008 and ADR-0020 clauses and the separate prerequisite for automatic Application type propagation.
