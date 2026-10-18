---
type: adr
title: ADR-0086 - Renders fit the destination's live columns, and tables shrink to fit
description: Core reads the destination's real width at the moment of each render and passes it to the view as columns, narrowed by POSIX COLUMNS and undefined off a terminal. The view context also gains wrap, an eager line breaker that breaks at spaces and never splits a word, and expandTabs, which turns tabs into spaces so text placed at an offset shows as it measures. Marked lanes wrap with the gutter, the table view shrinks its widest columns to fit and falls back to the records layout, and the records view wraps its values. Core's failure text, print, and help do not wrap.
status: proposed
created: 2026-10-17
modified: 2026-10-18
---

# ADR-0086 - Renders fit the destination's live columns, and tables shrink to fit

## Context

A view cannot learn how wide its destination is. The view context holds `style`, `width(text)`, and `plain(text)`, and the terminal width lives on `host.terminal`, which a view does not receive and which core reads once, at entry. A view that fits prose to the terminal needs a width from its author's own host plumbing, and a window that resizes during a long run, or between the rows of a streamed sequence, is never seen. The select question of `@loomcli/prompts` shows the cost: its frame data carries stderr's `columns` because the view could not read the width itself.

Three views also run past the screen. A long `out.warn` message wraps in the terminal at the edge, so its continuation lines start under the glyph instead of under the message. The table pads every column to its widest cell, so a table wider than the terminal soft-wraps and its columns no longer line up. The records view prints each value on one line.

[ADR-0077](0077-help-details-are-markdown-that-help-renders-with-its-own-subset-parser.md) keeps help from wrapping and from reading the terminal width. This record leaves that rule alone.

## Decision

### The width is live

`host.terminal.stdout.columns`, `host.terminal.stdout.rows`, `host.terminal.stderr.columns`, and `host.terminal.stderr.rows` are live readings. Process capture backs each with a read of the stream every time it is read, and Node and Bun both update those values when the window resizes. The type stays `number | undefined`, and a reported 0 reads `undefined`. `isTTY` stays captured once, because a stream does not change kind mid-run. A host override supplies plain numbers, which stay fixed, or its own getter when it wants a live value. Core keeps a supplied getter rather than copying its value. In a test whose `env` holds no `COLUMNS`, plain numbers give a fixed, deterministic width.

This supersedes [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md)'s clause that core copies terminal facts, for terminal width and height only. Every other clause of that record stands.

Just before each render call, core computes the effective width and passes it to the view as the plain number `context.columns`. Core builds a fresh context, with its own `columns`, for every render call: each lane write, `out.render`, result render, failure view, incomplete-result line, `out.draw`, and each `head`, `row`, and `tail` of a row view. A whole view over a sequence reads the width when it renders, after the source ends. A resize between two renders reaches the next one. Text already printed is never redrawn.

### Columns

The view context gains a required member `readonly columns: number | undefined`. Each context belongs to one destination. A context built for stdout reads stdout's width, and one built for stderr reads stderr's. The effective width is:

- `undefined` when the destination is not a terminal: a pipe, a redirect to a file, `app.invoke`, and so every MCP tool call. `COLUMNS` does not change this.
- On a terminal that reports a width, the smaller of that real width and `COLUMNS` when `COLUMNS` is valid, and the real width otherwise.
- On a terminal that reports no width, `COLUMNS` when it is valid, and `undefined` otherwise.

`COLUMNS` is valid when `host.env.COLUMNS` is a positive integer: ASCII digits 0-9 only, leading zeros allowed, a safe integer greater than zero. `COLUMNS` only narrows. It never widens a layout past a width the terminal reports. `host.terminal` never reflects `COLUMNS`: it is the real reading.

The context carries no fallback width. A view that wants one, such as 80, supplies its own. `FailureViewContext` extends `ViewContext`, so failure views receive `columns`, `wrap`, and `expandTabs`.

`out.draw` resolves to the number of rows the drawn text moved down, counted against the real width of stderr at that draw. The terminal soft-wraps at its real width, so a row count against a `COLUMNS`-narrowed width could move the cursor up too far.

### Wrap

The view context gains a required member `readonly wrap: (text: string, columns: number | undefined) => string`. It breaks lines when the view runs. It measures with the destination's glyph forms exactly as `width()` does, ignores style and hyperlink envelopes, and returns marked text with real line breaks inserted. `wrap` itself is not a deferred wire frame. `pad` stays the deferred minimum-width composer, and the [style wire contract](../style-wire.md) gains one frame, `nowrap`, described below.

The idiom is `context.wrap(text, context.columns)`. An undefined `columns` returns the text unchanged. Any other `columns` that is not a positive safe integer throws `RangeError('Wrap width must be a positive safe integer.')`.

- **Greedy.** Each output line takes as many words as fit within `columns`, and a line exactly `columns` wide fits.
- **Break opportunities are U+0020 spaces only.** Text without spaces, such as Chinese, Japanese, or Thai prose, does not wrap.
- **Existing line breaks are kept.** LF and CRLF stay as written, and each input line wraps independently. An inserted break is LF, or CRLF on an input line that ends in CRLF.
- **A word wider than `columns` stays whole** on its own line, so a URL, a token, a hash, a path without spaces, or any text inside `nowrap` copies intact.
- **The spaces at a break are dropped.** An input line's leading spaces are never a break, and they stay with its first word. Spaces at the end of an input line are never a break, and they stay with its last word. Both count toward the fit, so a last word whose trailing spaces would pass `columns` moves to its own line. Continuation lines start at column 0, and indenting them is the caller's job. Runs of spaces inside a line are kept.
- **Tabs** measure at stops of eight as `width()` does, and a line never breaks at a tab. `wrap` keeps each tab as written, so its stops count from column 0 of each output line.
- **A `pad` frame or a `nowrap` frame is one unit.** `wrap` measures a `pad` frame at its padded width and a `nowrap` frame at the width of its body, and never breaks inside either.
- **A style or a hyperlink that spans a break** continues across it. The break is inserted inside the envelope, as an authored line break sits, so the span continues on the next line. A lane's gutter on a continuation line carries the span as it does after an authored break.

### Tabs expand before a layout places text

A terminal counts a tab's stop from column 0 of the screen, while `width()` and `wrap` count it from column 0 of the text they read. Text placed after a gutter, a label, or another column then shows up to seven columns wider than it measured, and a line that fit passes `columns`.

The view context gains a required member `readonly expandTabs: (text: string) => string`. It replaces each tab in marked text with spaces up to the next multiple of eight, counted from the start of the tab's own input line, measured with the destination's glyph forms as `width()` measures. It keeps every frame header, escape, and ANSI command byte for byte. A tab inside a style frame or a `nowrap` frame expands as any other. A tab inside an ANSI control string is no tab, and a tab inside a `pad` frame stays, because the frame already expands it from its own start. The spaces it inserts are ordinary spaces, so `wrap` may break at them. It is unconditional, so a view that keeps tabs off a terminal calls it only when `columns` is defined.

When `columns` is defined, the marked lanes expand the message's tabs, the table expands each cell's and each header's, and the records layout expands each value's, each before it measures, fits, or wraps, so the output holds no tab and the screen shows what was measured. When `columns` is undefined their output keeps its tabs, byte for byte. `wrap` keeps tabs as written, and `print` is untouched.

A caller aligns a wrapped block by pairing wrap with pad, whose alignment applies per line: `pad(context.wrap(text, n), n, { align: 'center' })`. There is no separate align helper.

### nowrap keeps text whole

`@loomcli/core` exports `nowrap(text)` beside `pad`. It returns a deferred marked-string frame, `["nowrap"]` on the wire, whose body `wrap` keeps whole and whose width a table's floor counts whole. It resolves to its body exactly, with no added bytes, so copying the printed text gives the exact text. It takes one string and rejects any other value as `pad` does, with `TypeError('Style helpers require a string.')`. Frames nest, so a style or a glyph inside it is fine. A caller writes ``out.info(`Wrote ${nowrap(path)}`)``.

Loom's first-party messages wrap each filesystem path and URL they print in `nowrap`, wherever the text they reach resolves frames: a lane, a view such as the service status view, and a `FatalError`'s message. An `InputError`'s default text prints its message as data, so a frame there would show its delimiters, and a path in an `InputError`'s message or in a wrong value's label stays unmarked. The wrapping changes no message text, because the frame adds no bytes.

### splitLines makes lines that stand alone

`@loomcli/core` exports `splitLines(text)` beside `wrap` and `nowrap`. It splits marked text at its LF and CRLF line breaks into lines that each stand alone: every Loom frame, embedded SGR attribute, and embedded OSC 8 hyperlink open at a line's end closes there and opens again at the start of the next line, so lines placed side by side never leak onto the text beside them. A trailing line break adds no empty line, as `pad` adds no padded line after one. It reads the wire with core's own parser and ANSI recognizer, and it rejects a value that is not a string as `pad` does. The table and the records views split each wrapped cell and value with it, so no plugin parses the wire itself.

### Where core wraps

- **The marked lanes** `info`, `success`, `warn`, and `error` wrap the message at `columns` minus the measured glyph gutter, and continuation lines carry the gutter the lanes already give authored line breaks. `print` never wraps. On a terminal they expand the message's tabs first, as [Tabs expand before a layout places text](#tabs-expand-before-a-layout-places-text) states. With `columns` undefined, lane output is byte for byte what it was. With no column left after the gutter on a terminal narrower than it, the message is not wrapped, and its tabs still expand. An application that wants unwrapped lanes replaces the lane view, as it already can.
- **Core's default failure text does not wrap.** Each failure sentence stays one line on a terminal narrower than the sentence and on a pipe. An application that wants wrapped failures overrides the failure view and calls `context.wrap`.
- **The Developer Diagnostic** breaks its explanation with the same line breaker as `context.wrap`. Its banner and explanation fill stderr's effective width at that moment, or 80 when that is `undefined` or the text goes into `message`. A stderr that is not a terminal falls back to 80, even when a host override reports a width. The shared breaker measures terminal display width where the old one counted string length.
- **Help** is unchanged. It neither wraps nor reads the terminal width.

### Tables fit the screen

The table view, `@loomcli/plugins/table`, lays out against `columns` once per render. When `columns` is undefined, its output is byte for byte its natural-width output: every column padded to the widest of its header and cells. A `format` cell that returns several lines keeps today's bytes there. The layout that treats each line of a cell as a row line applies only when `columns` is defined.

When the natural width, which is the cells, the headers, and the two-space gaps, exceeds `columns`, columns shrink by levelling from the top. A column's floor is the widest unit `wrap` keeps whole in any of its cells or its header, measured with `context.width`: a word, with an input line's leading spaces on its first word and its trailing spaces on its last, or a `pad` frame or a `nowrap` frame, within one input line. The floor and `wrap` read the same units, so a column at its floor wraps every unit onto a line that fits. Levelling is stated exactly: find the largest whole level L at which the sum over columns of max(floor, min(natural, L)), plus the gaps, is at most `columns`. Each column's width is max(floor, min(natural, L)). Any remainder goes one column each, from the left, to the columns at exactly L whose natural width exceeds L. The fitted widths and gaps then total exactly `columns` whenever any column narrowed. The two-space gap stays and counts toward the fit.

Text in a narrowed column wraps inside the column with `wrap`'s rules, so rows grow taller and every value stays complete. A header counts toward its column's natural width and its floor, and it wraps like a cell. Every line of a wrapped cell keeps its column's alignment, because `pad` aligns per line. A cell's `format` output is what gets measured and wrapped, once its tabs have expanded from the start of the cell. A cell is never truncated. A row is as tall as its tallest cell, and each of its lines ends at its rightmost cell that has text at that height, which carries no padding, by the last column's rule. A shorter cell to its left adds a padded blank line, and the columns after it, with their gaps, are left off, so no line ends in a gap or in padding.

When the table cannot fit with every column at its floor, it renders as row blocks, the records layout: each row is a block of `HEADER  value` lines, using the table's header text, or the key as written, its styling, alignment, and `format`. The fallback's row blocks match the records view's row blocks for the same labels and left-aligned values. The fallback has no tail and highlights no identifier. A right- or center-aligned value aligns within its own widest wrapped line, no value line carries trailing padding, and a blank line carries no alignment and no indent. A line whose value is empty ends at its label, with no padding or gap after it, so a line with an empty label and an empty value is an empty line. Overflow happens only where a unit `wrap` keeps whole, or a label, exceeds the space, and the terminal soft-wraps it.

An empty sequence never takes the records fallback. With no rows, the natural width is the headers' alone. With a `columns` list configured, it prints its header line at the fitted widths, levelled and wrapped like any header row, so a filtered run still reports the shape it searched. When even the header floors exceed `columns`, every column sits at its floor and the line overflows.

### Records wrap their values

The records view, `@loomcli/plugins/records`, wraps each value at the width left after the padded key column. The table fallback uses the same layout: a label column, a two-space gap, a value that wraps, and a blank line between blocks. On a terminal, every continuation line of a value, authored or wrapped, is indented under the value, except a blank line, one that resolves to no character, which carries no indent. A line whose value is empty ends at its label, with no padding or gap after it, and a line with an empty label and an empty value is an empty line. On a terminal a value's tabs expand from the start of the value before it wraps. Each row of a streamed sequence reads its own width, in the context core builds for that `row` call. Off a terminal, the output is today's bytes, tabs included.

### Prompts

The select `questionFrame` data no longer carries `columns`. It keeps `rows`. The default select view reads `context.columns`, which is stderr's effective width because a question draws on stderr, and keeps its own 80-column fallback when that is undefined. The 80-column fallback applies to the compact frame's clipping alone, and the select window's height estimate assumes no wrapping when `columns` is `undefined`.

## Considered options

- **Reading the terminal width once at entry.** Rejected. A resize in a long run, or between the rows of a streamed sequence, would lay out for a stale width.
- **Redrawing printed text after a resize.** Rejected. Output is a stream that may be piped, scrolled, or copied, so only the next render takes the new width.
- **A fallback width such as 80 in the context.** Rejected. A view could not tell a pipe from a terminal, and piped output would get breaks no operator saw.
- **An optional `columns?` member.** Rejected. An absent member would mean both "not a terminal" and "not stated".
- **A deferred `wrap` wire frame like `pad`.** Rejected. Its breaks would not exist when a lane view adds its gutter or a caller indents per line.
- **UAX #14 line breaking now.** Rejected for now. It needs new line-break tables and a pair-table machine for prose that has spaces. It can replace the break rules inside `wrap` later without a signature change.
- **Breaking between wide characters as well.** Rejected. It has no kinsoku rules and nothing for Thai, and UAX #14 would undo it.
- **Splitting a word wider than the line.** Rejected. A real break inside a path without spaces, URL, or token breaks copying and link detection.
- **Accepting the split.** Rejected. A path with spaces splits wrong on screen, and macOS default folders have spaces.
- **`pad(path, 0)` as the marker.** Rejected. It reads as padding, and it is a second way to do the job.
- **Splitting a long word except URLs and paths.** Rejected. The remaining overlong words are tokens, hashes, and IDs that also need intact copy, and the detection list is a guess about author text.
- **A separate align helper.** Rejected. `pad` already aligns each line.
- **Leaving tabs to the terminal.** Rejected. A tab placed at an offset moves to a stop the view never measured, so a fitted line overflows.
- **Expanding tabs inside `wrap`.** Rejected. A view also wraps text it prints at column 0, where a tab already lands where it measured, and a line breaker that also rewrote whitespace would do two jobs.
- **Each plugin splitting the wire itself.** Rejected. A second parser of an internal wire drifts from core's: it hard-codes the delimiters, reads headers by rules of its own, and misses the SGR and hyperlink state that core's resolver carries across a line break, so a link or a color in one cell leaks into the next column.
- **Ignoring `COLUMNS`.** Rejected. It is how an operator asks for narrower output, for a narrow pane or a screenshot, and Python's `shutil` and clap honor it.
- **`COLUMNS` as a POSIX override that can exceed the window.** Rejected. A layout wider than the real screen is wrong on that screen.
- **Honoring `COLUMNS` on a pipe.** Rejected. Some shells export `COLUMNS`, which would wrap piped output unasked.
- **Truncating table cells with an ellipsis.** Rejected. Every value stays complete, so a cell copies whole.
- **Wrapping core's failure text.** Rejected. docker, git, and clap keep error lines whole for grep and bug reports.
- **Making help wrap in this decision.** Rejected. Help's no-width rule is ADR-0077's, and a record that supersedes it is separate.

## Consequences

The view context gains three required members. An existing view function keeps compiling, because it reads the context core passes. A `ViewContext` object built by hand, such as one in a test harness, and a wrapper that rebuilds the context must supply all three, so adding them is a breaking change for core, as adding `plain` was. A wrapper keeps the runtime context's `columns`, `wrap`, and `expandTabs`, and a hand-built context supplies all three. `@loomcli/core` also gains the `nowrap` and `splitLines` exports.

Output at a terminal changes. A long lane message wraps, a wide table shrinks or becomes records blocks, and a long records value wraps. The self-update notice is one `out.info` message. The example notice is 91 columns, and the shortest possible notice is 83, so every notice is wider than the 78 columns an 80-column terminal leaves after the info gutter and wraps there. A pipe, an invocation by name, and an MCP tool call see no change, which keeps golden fixtures that run without a terminal byte for byte stable, tables and records included.

A host that supplies plain numbers for `host.terminal` gets a fixed width, with an `env` that holds no `COLUMNS`, which keeps test hosts deterministic. A test that needs a resize supplies a getter or a pty-backed host.

An override of `questionFrame` that read `data.columns` reads `context.columns` instead, so the `@loomcli/prompts` change is breaking for such an override.

This supersedes [ADR-0009](0009-core-captures-the-host-and-resolves-an-exit-code.md) for terminal width and height only. It narrows [ADR-0022](0022-renderers-return-marked-strings-that-core-resolves-and-a-theme-is-a-palette.md) and [ADR-0027](0027-core-resolves-marked-output-and-one-theme-contribution.md), whose view context holds `style` and `width`, and ADR-0027's lane continuation, which now wraps where the destination's `columns` is defined. It narrows [ADR-0080](0080-the-self-update-plugin-tells-an-interactive-operator-about-a-newer-release-from-a-daily-cache.md), whose notice line now wraps with the info lane on a terminal whose `columns` is narrower than it. It changes the select frame data that the prompts reference specifies under [ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md); no clause of that record changes. Each of those records carries a dated entry. ADR-0077 stands.

The glossary gains Columns.

## Status

Proposed. It moves to accepted with the release that ships live terminal width, `columns`, `wrap`, `expandTabs`, `nowrap`, the lane wrapping, the shrinking table and its records fallback, the wrapping records view, and the prompts change. Tests prove each destination's width, the pipe, invocation, and MCP cases, `COLUMNS` as a narrowing on a terminal with and without a reported width, two renders either side of a resize under a pty-backed host, a streamed records row after a resize, each wrap rule, `nowrap` bodies that never break and resolve to themselves, wrapped lanes with their gutter, tabs that expand on a terminal so no lane, table, or records line overflows and stay off one, the table at natural width, shrunk, and as records blocks, the records view wrapping, byte-identical piped output, unchanged failure text, and the select clip at `context.columns`.

## Changelog

- 2026-10-17: Proposed with the live columns, wrap, and fitting contract.
- 2026-10-18: Amended before acceptance: an input line's trailing spaces stay with its last word and count toward the fit and the table floor, core exports `splitLines`, which the table and records views use in place of a splitter of their own, a table line ends at its rightmost cell that has text, a blank line in a records value carries no indent, and a first-party path is marked with `nowrap` only where its text resolves frames, which an `InputError`'s default text does not.
- 2026-10-18: Amended before acceptance: the view context gains `expandTabs`, and on a terminal the marked lanes, the table, and the records layout expand tabs before they measure, fit, or wrap, so a tab placed at an offset no longer overflows a line.
- 2026-10-18: Amended before acceptance: on a terminal a records or fallback line whose value is empty ends at its label, with no padding or gap after it.
- 2026-10-18: [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md), proposed, makes help wrap on a terminal, so this record's statement that help is unchanged, and that ADR-0077 stands, no longer holds once ADR-0087 is accepted. Help reuses `columns`, `wrap`, `expandTabs`, `splitLines`, `nowrap`, and the table's floor rule. It binds when that record is accepted.
