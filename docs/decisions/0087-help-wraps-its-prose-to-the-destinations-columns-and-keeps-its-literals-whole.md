---
type: adr
title: ADR-0087 - Help wraps its prose to the destination's columns and keeps its literals whole
description: On a terminal, the help page wraps its prose at the full columns of its view context with hanging indents, keeps usage forms, left cells, code, and example commands whole, stacks the rows under a heading whose right cells cannot fit, and reflows Details paragraphs at Markdown's soft line breaks. Off a terminal, every page keeps its bytes. This supersedes ADR-0077's clause that help neither wraps nor reads the terminal width.
status: accepted
created: 2026-10-18
modified: 2026-10-20
---

# ADR-0087 - Help wraps its prose to the destination's columns and keeps its literals whole

## Context

[ADR-0086](0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) gives every view the destination's live width as `columns`, with `wrap`, `expandTabs`, `splitLines`, and `nowrap` to lay text out against it, and it makes output that does not fit the screen a defect. It left help alone, because [ADR-0077](0077-help-details-are-markdown-that-help-renders-with-its-own-subset-parser.md) rules that the help page neither wraps nor reads the terminal width.

Help is the page an operator reads most, and it is the one that runs past the screen most. A right cell holds a description, an accepted-values sentence, and a parenthesis of facts, so one option row of jsonkit is 120 columns. On an 80-column terminal the terminal soft-wraps that row at column 0, under the option spellings, and the two-column layout no longer reads as two columns. A Details paragraph an author hard-wrapped at 72 columns reads ragged on a narrower window, a long line and a short one in turn.

Some text on the page is copied or read as syntax rather than read as prose: a usage form, an option's spellings, a code block, and an example command. A line break inserted into an example makes the pasted command fail, and a break inside a usage form or a spelling misleads.

## Decision

- **Where it applies.** The default help view reads `columns` from its view context. When `columns` is defined, the page lays out against it. When `columns` is `undefined`, as on a pipe, a file, an invocation by name, and an MCP tool call, every page is byte for byte the page it is without this record, tabs included. `COLUMNS` narrows help as it narrows every view. Both variants follow the same rules.
- **The full width, with no cap.** Help wraps at `columns` itself. It adds no maximum line length such as clap's 100 or click's 80, so help follows the one width rule every Loom view follows, and an operator who wants narrower help sets `COLUMNS`.
- **Prose wraps, and literals stay whole.** The masthead description, the deprecation message under a masthead, every right cell, Details paragraphs, headings, list items, and quotes, the INPUT block's sentences, option-group sentences, example notes, and hints wrap. Usage forms, section titles, inner headings, left cells, Details code, Details table rows, and thematic breaks, the INPUT example, and example commands never wrap, and one wider than its space overflows for the terminal to soft-wrap. Inside prose, a Details code span and the command a hint names sit in `nowrap`, so each stays on one line.
- **Hanging indents.** Each continuation line starts where its text's first line started: a right cell under the right cell's column, the masthead description after `<path> · `, a list item after its marker, a quote after its `> `, and a hint at the left margin. When a text's continuation indent and its floor cannot fit `columns`, its continuation lines start at its block's base indent instead, and its first line keeps its place.
- **Rows that cannot fit stack.** The rows that share a left column, an outer heading's direct rows or one inner heading's rows, keep it. Their floor is the widest unit `wrap` keeps whole in any of their right cells, as a table column's floor is. When their indent, left column, and floor together exceed `columns`, the rows under that heading stack: each left cell prints on its own line and its right cell wraps on the lines below, four columns further in than the furthest-in left cell's text. The rows under every other heading keep two columns.
- **Details reflow at soft line breaks.** On a terminal, the lines of a Details paragraph join with one space, which is what Markdown's soft line break means, and the joined text wraps to the width. List items, quotes, and a heading, which is one line, wraps as a paragraph does. Code never reflows. Inline constructs still read per authored line, so joining changes no styling. No hard-break syntax joins the subset, and the subset can still grow under ADR-0077's rule. Off a terminal, each authored line stays one page line.
- **The rest of the page stands.** `HelpPage`, the view's identity, its replacement, its styles, its escaping, and every content rule are unchanged. The pack exports no layout helper and no parser. The version line neither wraps nor reads the width.

The contract and its acceptance are in [Help wraps to the destination's columns](../core.md#help-wraps-to-the-destinations-columns).

## Considered options

- **Wrapping every line, usage and examples included, with hanging indents.** Rejected. A pasted example would break, and a usage form split across lines reads as two forms.
- **Wrapping usage alone with a hanging indent, as argparse does.** Rejected. Usage forms are short, and the rule would serve a rare case.
- **A cap at 100 columns, as clap has, or at 80, as click has.** Rejected. A cap is a line-length opinion Loom would hold for every author, and help would be the one view that does not fill the width it reads.
- **Continuation lines under the section's indent.** Rejected. A continuation under the option spellings blurs which row it belongs to.
- **A fixed help column, as argparse's `max_help_position`.** Rejected. It adds a number of Loom's own and changes the layout of a page that already fits.
- **No fallback for a squeezed right cell.** Rejected. A word wider than the column left over overflows, which is the misfit output ADR-0086 calls a defect.
- **Keeping each authored Details line and wrapping it on its own.** Rejected. A paragraph hard-wrapped wider than the window reads ragged.
- **Adding CommonMark's hard line break to the subset.** Deferred. No author has needed a forced break inside a paragraph, and a blank line still starts a new one.

## Consequences

The help page's bytes change on a terminal: rows wrap under their right column, squeezed rows stack, and a multi-line Details paragraph reflows to the width even where every line fit. A pipe, an invocation by name, and an MCP tool call see no change, so golden fixtures that run without a terminal stay byte for byte stable. Under the repository's changelog rules a change to help page bytes is never breaking, so the change ships as a feature of `@loomcli/plugins`.

The manpage plugin already fills Details paragraphs through `man`, so a terminal page and a man page now read Details the same way. The manifest still carries the Markdown as written.

This supersedes ADR-0077's clause that the page neither wraps nor reads the terminal width, and reverses its rejection of soft-break wrapping, whose reason was that help read no width. Every other clause of ADR-0077 stands. It narrows [ADR-0058](0058-help-owns-ordered-sections-with-at-most-two-heading-levels.md)'s one-layout rule, for the indentation of wrapped and stacked lines, and it replaces ADR-0086's statement that help is unchanged. ADR-0058, ADR-0077, and ADR-0086 carry dated entries.

## Status

Accepted in 0.14.0.

## Changelog

- 2026-10-18: Proposed with the help wrapping contract.
- 2026-10-18: Implementation in the default help view, which wraps prose, stacks row sets whose floor cannot fit, and reflows Details on a terminal while every page off one keeps its bytes. Process fixtures under Node and Bun prove it, including jsonkit's 60-column page and its stacked 30-column COMMANDS block byte for byte.
- 2026-10-18: Amended before acceptance: the INPUT block's sentences and option-group sentences wrap as prose, and the INPUT example line stays whole.
- 2026-10-18: Amended before acceptance: a stacked row set's right cells start four columns past the furthest-in start of a left cell's text, so a long-only option's description no longer shares its spelling's column.
- 2026-10-19: Amended before acceptance: consecutive Details lines that start with `|` keep their lines and never reflow, which grows ADR-0077's subset.
- 2026-10-19: Amended before acceptance: a hanging text whose continuation indent and floor exceed `columns` continues at its block's base indent, indent 2 for the masthead description and the deprecation message and the list's own indent for a list item, while its first line keeps its place.
