---
type: adr
title: ADR-0077 - Help details are Markdown that help renders with its own subset parser
description: A Command's details is always Markdown, a string the author writes inline or brings in with a text import, which loom build inlines for every target with no embedding seam. The extended help page renders a stated subset, paragraphs, headings, lists, code, quotes, emphasis, and links, with a parser the pack writes itself and loads with the page view, keeping every authored line break and one blank line wherever the author left one or more, and wrapping nothing. Text outside the subset, other than a thematic break, reads as paragraph text. The manifest carries the Markdown as written. This narrows ADR-0058's rule that no help block holds a blank line, for the Details block alone.
status: accepted
created: 2026-10-13
modified: 2026-10-18
---

# ADR-0077 - Help details are Markdown that help renders with its own subset parser

## Context

A Command's `details` is the prose the extended help page prints after the masthead. Today it is lines: every line holds a character other than whitespace, so it has no paragraphs, and the page prints each line as written. An author who teaches a Command at any length wants paragraphs, a list of cases, a code sample, and a link, and writes them in Markdown in a README already. The original help design let details be Markdown, written inline or kept in a file of its own.

Three facts shape how. The help page's view loads with the help plugin's entry on every run and renders synchronously under [ADR-0008](0008-rendered-output-is-a-neutral-call.md) and [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md), so whatever parses the Markdown loads on every run of every application that installs help. A full CommonMark parser, `mdast-util-from-markdown`, which the toolchain already uses for changelogs, measured about 120 KB minified and about 13 ms to load. [ADR-0076](0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md) gave `loom build` no file-embedding seam, because development runs and tests never pass through the build, and Bun's text import already inlines a file's text into a bundle or a binary for every target. The help page is read in a terminal and through a pipe, and no meaning on it depends on styling.

## Decision

- **Details is always Markdown.** `details` on `helpCommand` and on the manifest's `manifestCommand` is Markdown, a string that holds a character other than whitespace, with blank lines allowed, so a file's text passes as it is. There is no flag that marks a value as Markdown or as plain lines. Plain details whose lines use no Markdown syntax and no whitespace at either end print as they did.
- **A file arrives as a string.** Help reads strings and no files. An author who keeps details in a file imports it as text, `import details from './get.md' with { type: 'text' }`, which Bun reads in a source run and a test and which `loom build` inlines for every target. `loom build` gains no embedding seam, and `details` takes no loader: help's hook hands `details` to the manifest when the Command attaches, and help text is small enough that holding it on every run costs nothing worth a lazy path.
- **Help parses a stated subset with its own parser.** The pack carries a parser for paragraphs, headings, bullet and ordered lists that nest, fenced and indented code, quotes, emphasis, strong emphasis, code spans, links, images, and autolinks, with each rule stated in the contract. It is not CommonMark: a construct outside the subset, such as a table, a setext heading, a reference link, or HTML, reads as paragraph text, and a thematic break prints as written. The subset can grow, and a construct it adds changes only text that read as paragraph text, or a thematic break that printed as written, before.
- **Line breaks and blank lines are kept, and nothing wraps.** Each authored line of a paragraph is one page line, one blank line separates two blocks exactly where the author left one or more, and the page still neither wraps nor reads the terminal width, so a page's layout stays the author's. The Details block may therefore hold blank lines of its own, which narrows [ADR-0058](0058-help-owns-ordered-sections-with-at-most-two-heading-levels.md)'s rule that a help block holds none, for that block alone.
- **The text reads without styling.** Emphasis and heading markers are dropped and styles carry them, because stress and a heading's level are presentation. A code span keeps its backticks and a link prints its destination, because a literal token and an address are meaning the reader needs with styling off. Every authored fragment is escaped before styling, so a marker character prints literally.
- **The manifest carries the Markdown as written.** Help supplies `details` to `manifestCommand` unchanged, so an agent reads the source, which it reads well, and a later projection that renders details another way parses the same text.

The contract and its acceptance are in [Markdown details](../core.md#markdown-details).

## Considered options

- **An opt-in flag beside `details`.** Rejected. It leaves existing pages untouched, but it is a second way to write the same field, and plain details already render the same under the subset.
- **A `loom build` embedding seam, or a lazy loader in `details`.** Rejected for the reasons ADR-0076 records for skills, and because help's hook reads `details` when the Command attaches.
- **`mdast-util-from-markdown`, loaded with the view.** Rejected. Full CommonMark costs every run of every application that installs help, help or not.
- **Parsing in the help middleware and handing the view a tree.** Rejected. The middleware loads only when help runs, but the `HelpPage` data a replacement view receives would gain a syntax tree as public API.
- **CommonMark's soft line breaks, wrapped to the terminal width.** Rejected. Help reads no terminal width, and joining an author's lines would change every multi-line details page.

## Consequences

An application whose details uses Markdown syntax as plain text, such as a line that starts with `- `, a word between asterisks, or a backslash before punctuation, prints it rendered after upgrading, and a paragraph line loses the whitespace at both ends. No application has to change its code and the new schema rejects nothing the old one accepted, so under the repository's changelog rules, where a change to the help page's bytes is never breaking, the change ships as a feature. The `manifestCommand` schema accepts blank lines, and the MCP tool description keeps the prose rule. A whole-page replacement of `helpPage` that wants rendered details renders them itself; the pack exports no parser. ADR-0058 carries a dated entry for the narrowing.

## Status

Accepted in 0.12.0.

## Changelog

- 2026-10-13: Proposed with the Markdown details contract.
- 2026-10-18: [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md), proposed, supersedes this record's clause that the page neither wraps nor reads the terminal width, and reverses its rejection of soft-break wrapping, whose reason was that help read no width. On a terminal, help wraps its prose at its context's `columns`, and the lines of a Details paragraph, list item, quote, or heading join at soft line breaks and wrap. Off a terminal each authored line stays one page line. Every other clause stands. It binds when that record is accepted.
