---
type: adr
title: ADR-0077 - Help details are Markdown that help renders with its own subset parser
description: A Command's details is always Markdown, a string the author writes inline or brings in with a text import, which loom build inlines for every target with no embedding seam. The extended help page renders a stated subset, paragraphs, headings, lists, code, quotes, emphasis, and links, with a parser the pack writes itself and loads with the page view, keeping every authored line break and wrapping nothing. Everything outside the subset prints as written. The manifest carries the Markdown as written.
status: proposed
created: 2026-10-13
modified: 2026-10-13
---

# ADR-0077 - Help details are Markdown that help renders with its own subset parser

## Context

A Command's `details` is the prose the extended help page prints after the masthead. Today it is lines: every line holds a character other than whitespace, so it has no paragraphs, and the page prints each line as written. An author who teaches a Command at any length wants paragraphs, a list of cases, a code sample, and a link, and writes them in Markdown in a README already. The original help design let details be Markdown, written inline or kept in a file of its own.

Three facts shape how. The help page's view loads with the help plugin's entry on every run and renders synchronously under [ADR-0008](0008-rendered-output-is-a-neutral-call.md) and [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md), so whatever parses the Markdown loads on every run of every application that installs help. A full CommonMark parser, `mdast-util-from-markdown`, which the toolchain already uses for changelogs, measured about 120 KB minified and about 13 ms to load. [ADR-0076](0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md) gave `loom build` no file-embedding seam, because development runs and tests never pass through the build, and Bun's text import already inlines a file's text into a bundle or a binary for every target. The help page is read in a terminal and through a pipe, and no meaning on it depends on styling.

## Decision

- **Details is always Markdown.** `details` on `helpCommand` and on the manifest's `manifestCommand` is Markdown, a string that holds a character other than whitespace, with blank lines allowed, so a file's text passes as it is. There is no flag that marks a value as Markdown or as plain lines. Plain details that use no Markdown syntax print as they did.
- **A file arrives as a string.** Help reads strings and no files. An author who keeps details in a file imports it as text, `import details from './get.md' with { type: 'text' }`, which Bun reads in a source run and a test and which `loom build` inlines for every target. `loom build` gains no embedding seam, and `details` takes no loader: help's hook hands `details` to the manifest when the Command attaches, and help text is small enough that holding it on every run costs nothing worth a lazy path.
- **Help parses a stated subset with its own parser.** The pack carries a parser for paragraphs, headings, bullet and ordered lists that nest, fenced code, quotes, emphasis, strong emphasis, code spans, links, images, and autolinks, with each rule stated in the contract. It is not CommonMark: a construct outside the subset, such as a table, a setext heading, an indented code block, a reference link, or HTML, prints as written. The subset can grow, and a construct it adds changes only text that printed as written before.
- **Line breaks are kept and nothing wraps.** Each authored line of a paragraph is one page line, a blank line separates blocks, and the page still neither wraps nor reads the terminal width, so a page's layout stays the author's.
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

An application whose details uses Markdown syntax as plain text, such as a line that starts with `- ` or a word between asterisks, prints it rendered after upgrading, and a paragraph line loses its leading whitespace, so the change ships as breaking. The `manifestCommand` schema accepts blank lines, and the MCP tool description keeps the line rule. A whole-page replacement of `helpPage` that wants rendered details renders them itself; the pack exports no parser.

## Status

Proposed with the Markdown details contract. It moves to accepted in the release PR of the release that ships the implementation.

## Changelog

- 2026-10-13: Proposed with the Markdown details contract.
