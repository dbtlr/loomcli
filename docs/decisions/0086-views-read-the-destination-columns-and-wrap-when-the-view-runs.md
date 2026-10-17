---
type: adr
title: ADR-0086 - Views read the destination's columns and wrap when the view runs
description: The view context gains columns, the destination's width or undefined when it is not a terminal, with POSIX COLUMNS as the preferred width on a terminal, and wrap, an eager line breaker that breaks at spaces and never splits a word. Core's marked lanes wrap with the gutter, and print, failure text, and help do not wrap.
status: proposed
created: 2026-10-17
modified: 2026-10-17
---

# ADR-0086 - Views read the destination's columns and wrap when the view runs

## Context

A view cannot learn how wide its destination is. The view context holds `style`, `width(text)`, and `plain(text)`, and the terminal width lives on `host.terminal`, which a view does not receive. A view that fits prose to the terminal needs a width from its author's own host plumbing. The select question of `@loomcli/prompts` shows the cost: its frame data carries stderr's `columns` because the view could not read the width itself.

The marked lanes have a related gap. A long `out.warn` message wraps in the terminal at the edge, so its continuation lines start under the glyph instead of under the message.

[ADR-0077](0077-help-details-are-markdown-that-help-renders-with-its-own-subset-parser.md) keeps help from wrapping and from reading the terminal width. This record leaves that rule alone.

## Decision

### Columns

The view context gains a required member `readonly columns: number | undefined`. It follows the context's destination. A context built for stdout reads stdout's width, and one built for stderr reads stderr's.

`columns` is `undefined` when the destination is not a terminal: a pipe, a redirect to a file, `app.invoke`, and so every MCP tool call. The context carries no fallback width. A view that wants one, such as 80, supplies its own.

On a terminal destination, `columns` is the POSIX `COLUMNS` value when `host.env.COLUMNS` is a positive integer: ASCII digits 0-9 only, leading zeros allowed, a safe integer greater than zero. `COLUMNS` wins on any terminal destination, including one whose width the capture did not find. Otherwise `columns` is the detected terminal width, which is `undefined` when the capture found none. On a destination that is not a terminal, `columns` is `undefined` whatever `COLUMNS` says. `COLUMNS` changes layout only. `host.terminal.stdout.columns` and `host.terminal.stderr.columns` keep the captured width, and the wrapped-row count `out.draw` resolves to uses the captured width, so erasing a drawn region stays correct for a region that fits the screen.

`FailureViewContext` extends `ViewContext`, so failure views receive `columns` and `wrap`.

### Wrap

The view context gains a required member `readonly wrap: (text: string, columns: number | undefined) => string`. It breaks lines when the view runs. It measures with the destination's glyph forms exactly as `width()` does, ignores style and hyperlink envelopes, and returns marked text with real line breaks inserted. It is not a deferred wire frame, and the [style wire contract](../style-wire.md) gains no frame. `pad` stays the deferred minimum-width composer.

The idiom is `context.wrap(text, context.columns)`. An undefined `columns` returns the text unchanged. Any other `columns` that is not a positive safe integer throws `RangeError('Wrap width must be a positive safe integer.')`.

- **Greedy.** Each output line takes as many words as fit within `columns`, and a line exactly `columns` wide fits.
- **Break opportunities are U+0020 spaces only.** Text without spaces, such as Chinese, Japanese, or Thai prose, does not wrap.
- **Existing line breaks are kept.** LF and CRLF stay as written, and each input line wraps independently. An inserted break is LF, or CRLF on an input line that ends in CRLF.
- **A word wider than `columns` stays whole** on its own line, so a path, a URL, a token, or a hash copies intact.
- **The spaces at a break are dropped.** An input line's leading spaces are never a break, and they stay with its first word. Spaces at the end of an input line are never a break. Continuation lines start at column 0, and indenting them is the caller's job. Runs of spaces inside a line are kept.
- **Tabs** measure at stops of eight as `width()` does, and a line never breaks at a tab.
- **A `pad` frame is one unit.** `wrap` measures it at its padded width and never breaks inside it.
- **A style or a hyperlink that spans a break** continues across it. The break is inserted inside the envelope, as an authored line break sits, so the span continues on the next line. A lane's gutter on a continuation line carries the span as it does after an authored break.

A caller aligns a wrapped block by pairing wrap with pad, whose alignment applies per line: `pad(context.wrap(text, n), n, { align: 'center' })`. There is no separate align helper.

### Where core wraps

- **The marked lanes** `info`, `success`, `warn`, and `error` wrap the message at `columns` minus the measured glyph gutter, and continuation lines carry the gutter the lanes already give authored line breaks. `print` never wraps. With `columns` undefined, or with no column left after the gutter on a terminal narrower than it, lane output is byte for byte what it was. An application that wants unwrapped lanes replaces the lane view, as it already can.
- **Core's default failure text does not wrap.** Each failure sentence stays one line on a terminal narrower than the sentence and on a pipe. An application that wants wrapped failures overrides the failure view and calls `context.wrap`.
- **The Developer Diagnostic** breaks its explanation with the same line breaker as `context.wrap`, under the width rule it already has: stderr's captured width, or 80 when that is unknown or the text goes into `message`. `COLUMNS` does not change it. The shared breaker measures terminal display width where the old one counted string length.
- **Help** is unchanged. It neither wraps nor reads the terminal width.

### Prompts

The select `questionFrame` data no longer carries `columns`. It keeps `rows`. The default select view reads `context.columns`, which is stderr's width because a question draws on stderr, and keeps its own 80-column fallback when that is undefined. The 80-column fallback applies to the compact frame's clipping alone, and the select window's height estimate assumes no wrapping when `columns` is `undefined`.

## Considered options

- **A fallback width such as 80 in the context.** Rejected. A view could not tell a pipe from a terminal, and piped output would get breaks no operator saw.
- **An optional `columns?` member.** Rejected. An absent member would mean both "not a terminal" and "not stated".
- **A deferred `wrap` wire frame like `pad`.** Rejected. Its breaks would not exist when a lane view adds its gutter or a caller indents per line.
- **UAX #14 line breaking now.** Rejected for now. It needs new line-break tables and a pair-table machine for prose that has spaces. It can replace the break rules inside `wrap` later without a signature change.
- **Breaking between wide characters as well.** Rejected. It has no kinsoku rules and nothing for Thai, and UAX #14 would undo it.
- **Splitting a word wider than the line.** Rejected. A real break inside a path, URL, or token breaks copying and link detection.
- **Splitting a long word except URLs and paths.** Rejected. The remaining overlong words are tokens, hashes, and IDs that also need intact copy, and the detection list is a guess about author text.
- **A separate align helper.** Rejected. `pad` already aligns each line.
- **Ignoring `COLUMNS`.** Rejected. POSIX defines it as the preferred width, and Python's `shutil` and clap honor it.
- **Honoring `COLUMNS` on a pipe.** Rejected. Some shells export `COLUMNS`, which would wrap piped output unasked.
- **Wrapping core's failure text.** Rejected. docker, git, and clap keep error lines whole for grep and bug reports.
- **Making help wrap in this decision.** Rejected. Help's no-width rule is ADR-0077's, and a record that supersedes it is separate.

## Consequences

The view context gains two required members. An existing view function keeps compiling, because it reads the context core passes. A `ViewContext` object built by hand, such as one in a test, must supply both members.

A long lane message now wraps on a terminal, which changes output an operator saw before. The self-update notice is one `out.info` message of more than 90 columns, so it wraps on an 80-column terminal. A pipe, an invocation by name, and an MCP tool call see no change, which keeps golden fixtures that run without a terminal byte for byte stable.

An override of `questionFrame` that read `data.columns` reads `context.columns` instead, so the `@loomcli/prompts` change is breaking for such an override.

This narrows [ADR-0022](0022-renderers-return-marked-strings-that-core-resolves-and-a-theme-is-a-palette.md) and [ADR-0027](0027-core-resolves-marked-output-and-one-theme-contribution.md), whose view context holds `style` and `width`, and ADR-0027's lane continuation, which now wraps where the destination's `columns` is defined. It narrows [ADR-0080](0080-the-self-update-plugin-tells-an-interactive-operator-about-a-newer-release-from-a-daily-cache.md), whose notice line now wraps with the info lane on a terminal narrower than it. It changes the select frame data that the prompts reference specifies under [ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md); no clause of that record changes. Each of those records carries a dated entry. ADR-0077 stands.

The glossary gains Columns.

## Status

Proposed. It moves to accepted with the release that ships `columns`, `wrap`, the lane wrapping, and the prompts change, proven by tests for the width of each destination, the pipe, invocation, and MCP cases, `COLUMNS` on a terminal, with or without a captured width, and its absence of effect elsewhere, each wrap rule, wrapped lanes with their gutter, unchanged failure text, and the select clip at `context.columns`.

## Changelog

- 2026-10-17: Proposed with the view columns and wrap contract.
