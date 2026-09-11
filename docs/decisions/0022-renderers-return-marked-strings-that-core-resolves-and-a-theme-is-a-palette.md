---
type: adr
title: ADR-0022 - Renderers return marked strings that core resolves for the host, and a theme is a palette
description: A renderer stays a pure synchronous function returning one string, and that string carries semantic color tokens and named glyphs as markup delimited by private-use code points rather than escape bytes. Core owns the token vocabulary, the glyph inventory, capability detection, the degradation ladder, and the resolution step, and a theme is a plugin that maps tokens to colors and nothing else.
status: proposed
created: 2026-09-11
modified: 2026-09-11
---

# ADR-0022 - Renderers return marked strings that core resolves for the host, and a theme is a palette

## Context

Styled terminal output needs a seam. A renderer that writes escape bytes itself has to answer questions it cannot see: whether this stream is a terminal, what color depth it supports, whether `NO_COLOR` is set, and whether the destination is a pipe. Every renderer author would answer them again, and each would get a slightly different answer, because stdout and stderr can differ within one invocation.

A renderer stays what ADR-0008 made it: a pure, synchronous function from one value to one string. What changes is what the string contains. It carries semantic color tokens and named glyphs as markup that a typed helper produces, never escape bytes, and core resolves that markup for the host before writing.

Core owns everything the resolution needs. The token vocabulary starts at seven core tokens, `dim`, `primary`, `highlight`, `success`, `warning`, `error`, and `info`, and is open: a plugin or an application mints more as descriptors. Core owns the glyph inventory, where each glyph has a fixed ASCII fallback and a fixed paired token, so a renderer never writes a mark and a color separately and never disagrees with another renderer about which mark means success. Core owns per-stream capability detection, `NO_COLOR`, the degradation ladder from truecolor to 256 colors to 16 colors to none, the `width` and `pad` helpers that measure a string with its markup removed, and the resolution step that rewrites markup to escapes or strips it.

The wire form delimits a token with private-use code points, one opening the token with its identity and one closing it. Private-use code points are legal in data and rare in it, so the contract does not assume their absence. The style helpers neutralize the delimiter code points in the text they wrap, so wrapped data cannot break out of or into markup, and the resolver treats a delimiter that does not open a registered token or close an open one as literal text. A renderer author never writes an escaping rule; the helpers and the resolver own it. Nesting is a stack that restores the outer token, and stripping is mechanical. The `width` and `pad` helpers exist because the native string methods count markup, which is the one trap a table cell walks into.

A theme is a plugin that maps tokens to colors and nothing else. A color is a named terminal color or a custom value core degrades down the ladder. A theme carries no glyph names, no capability decisions, and no layout, so a theme author writes one value per token and cannot make a mark disappear. Core installs no theme, following ADR-0013, so an application with none installed prints plain text and still prints glyphs. Meaning therefore never rides on color alone.

The authoring surface is a style object: `style.highlight('…')` returns marked text, `glyph.success` is a constant marked string carrying the glyph already wrapped in its paired token, and a `styles` factory extends the object with minted tokens so the calling form never changes between core's tokens and a plugin's. Tokens are descriptors, so a misspelled token is a compile error and two plugins cannot collide on a name.

## Considered options

- **A structured span document instead of a marked string.** Rejected. It is a larger contract, it supersedes ADR-0008's pure synchronous renderer rather than surviving beside it, and the only consumer that needs the structure is a live-region broker for progress and prompts, which is deferred. A marked string keeps the renderer contract and reaches the same output.
- **Brace markup or another printable delimiter.** Rejected. Any delimiter drawn from printable characters needs an escaping rule for data that contains it, and that rule is a bug surface on every interpolation of user data.
- **A theme that also owns glyphs, fallbacks, and capability decisions.** Rejected. It would let a theme drop the non-color channel, which is the channel that keeps output readable with no theme, under `NO_COLOR`, and through a pipe, and it would make a theme author answer host questions instead of choosing colors.

## Consequences

ADR-0008 survives and takes a dated entry when this record is accepted. Its rule that a renderer is pure, synchronous, holds no output handle, and owns its trailing newline is unchanged. The one sentence that no longer holds is that a renderer produces the exact bytes core writes: core resolves markup to escapes or strips it before writing, and the byte count of what core writes differs from the length of the string the renderer returned.

Escaping is owned by the style helpers and the resolver, never by a renderer author. A bare delimiter that reaches the resolver outside any helper resolves under the rule above, literal text unless it opens a registered token or closes an open one, and the phase contract does not reopen that rule. The contract chooses the code points and requires that a first-party view routes every piece of data it interpolates through a helper, so unwrapped data never reaches the resolver from a first-party view. Color-only meaning is prevented by core owning the glyphs.

The exact surface is deferred to the phase contract: the sentinel code points, the nesting rule, the per-stream detection rule, the precedence of `NO_COLOR` against `FORCE_COLOR`, the rule that selects a Unicode glyph or its ASCII fallback, and what a lane view receives when a message spans several lines. A tagged-template form is sugar over the same helper and can arrive later without changing this decision.

Terminal and encoding detection has to agree between Node and Bun, so acceptance runs both. Windows stays unverified.

## Status

Proposed. It moves to accepted with the phase implementation of the style seam and the first theme in the plugin pack, proved through the example applications: `textstat --timing` prints its elapsed line on stderr with the info glyph, in Unicode at a UTF-8 terminal and in ASCII otherwise, and prints identical plain text under `NO_COLOR` or through a pipe; and `textstat --total` at a color terminal highlights the total row with the theme installed and prints plain text without it. ADR-0008 takes a dated entry at that point.
