---
type: adr
title: ADR-0143 - A help page ends with the epilogs of the routed Command and its ancestors
description: helpCommand gains epilog, Markdown under the rule and the renderer details uses. Both help variants end with one block per epilog on the routed Command's path, its own first and the Application's last, after the hints, and each man page prints the same epilogs under NOTES before SEE ALSO. Help supplies no epilog to the manifest.
status: proposed
created: 2026-11-09
modified: 2026-11-09
---

# ADR-0143 - A help page ends with the epilogs of the routed Command and its ancestors

## Context

An application points its operators somewhere after its help: where to report a bug, where the full documentation lives, or which page covers a group of Commands. clap prints `after_help` after the page, Commander adds text with `addHelpText('after')` and, for every subcommand's page, `addHelpText('afterAll')`, and yargs prints an `epilog`.

A Loom author has two places for that text today. Details, under [ADR-0077](0077-help-details-are-markdown-that-help-renders-with-its-own-subset-parser.md), prints right under the masthead, on the extended page alone, and on the page of the Command that declares it alone. The other place is an override of `helpPage`, which replaces the whole page to add one line. A support link that every page should end with fits neither.

## Decision

- **The field.** `HelpCommandFacts` gains `epilog?: string`, so a Command or the Application carries it through `helpCommand`. An epilog is Markdown under the rule `details` follows: a string that holds a character other than whitespace, blank lines and a final line terminator allowed, written inline or brought in with a text import, and a value that breaks the rule reads `Supply Markdown that holds a character other than whitespace.`
- **Which epilogs a page prints.** A page prints the epilog of each Command on the routed Command's path that carries one: the routed Command's own first, then its parent's, and so on out to the Application's, last. An application that sets its support link once, on the Application, ends every page with it, and a group's own epilog, such as a link to the group's documentation, prints above it on the group's page and on every page under the group. A hidden Command on the path contributes its epilog as any other does, because the operator reached its page. Two equal epilogs on one path both print.
- **Both variants.** The compact page and the extended page print the epilogs alike, because an operator who typed `-h` needs the place to go next as much as one who typed `--help`. The compact page's pointer to `--help` still names Details and EXAMPLES alone, and an epilog never causes it.
- **Its place and form.** Each epilog is one block, after the hints, so the epilogs end the page. Help renders each with the Markdown subset and styles of Details, each line indented two spaces, and keeps one blank line inside it wherever the author separated two Markdown blocks, and the empty lines inside its code. Off a terminal each authored line stays one page line, and on a terminal its paragraphs reflow to `columns` under [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md), as Details' paragraphs do. The help Command's page and a paged page are the same page, so they print the same epilogs.
- **The man page.** Each man page prints the same epilogs, in the same order, in a NOTES section after ENVIRONMENT and before SEE ALSO, each parsed on its own, as on the help page, and its blocks written under the man page's Markdown rules for `details` after the blocks of the epilog before it, so the man page's paragraph-break rule decides each request between them. A page with no epilog on its path has no NOTES.
- **The manifest.** Help supplies `details` and `examples` to `manifestCommand` and no epilog. An epilog points a reader at a place outside the page, and the manifest describes the Command. A projection that wants it reads `helpCommand` through `readExtension`, as the man page does.

The contract and its acceptance are in [The help page](../plugins/help-page.md#the-help-page), [Help extensions](../plugins/help.md#help-extensions), and [the man page](../plugins/manpage.md#the-page).

## Considered options

- **An epilog on its own page only, as Details and section order are.** Rejected by the owner's ruling. A support link on every page would mean repeating it on every Command, which is clap's `after_help` and the burden this field exists to remove.
- **The nearest epilog on the path wins.** Rejected by the owner's ruling. A group's own link would replace the application's support link on every page under the group, so the support link would disappear exactly where a group adds context.
- **The extended page alone, as Details and EXAMPLES.** Rejected by the owner's ruling. The text is where an operator goes next, which the compact page's reader needs too.
- **Plain lines, printed as written.** Rejected by the owner's ruling. A paragraph holding a long URL would never reflow on a terminal, and help would carry a second kind of author text beside Markdown, against principle 5.
- **A setting on `help()`, such as `help({ epilog })`.** Rejected. A plugin setting is not a graph fact, so the man page and every other projection could not read it, and an epilog on a group would need a second mechanism.
- **The epilogs before the hints.** Not chosen. The hints are about this page's Commands and variants, and an epilog points away from the page, so it reads last.
- **Supplying the epilog to the manifest.** Not chosen, for the reason the decision states. An agent that needs the link reads the extension value.

## Consequences

`HelpCommandFacts` gains `epilog`, in a feature fragment of `@loomcli/plugins`. An application that declares no epilog prints the same bytes as before on every help page and every man page.

The help page and the man page read one function for the epilogs on a path, so the two cannot disagree on which epilogs print or in which order.

This extends [ADR-0077](0077-help-details-are-markdown-that-help-renders-with-its-own-subset-parser.md)'s Markdown subset and [ADR-0087](0087-help-wraps-its-prose-to-the-destinations-columns-and-keeps-its-literals-whole.md)'s reflow to the epilog. It narrows [ADR-0058](0058-help-owns-ordered-sections-with-at-most-two-heading-levels.md)'s one-layout rule that no blank line sits inside a block for each epilog block, as ADR-0077 narrowed it for Details, and adds a NOTES section to [ADR-0079](0079-the-manpage-plugin-writes-a-roff-page-per-command-and-installs-the-set-in-the-home-folder.md)'s page. ADR-0058, ADR-0077, ADR-0079, and ADR-0087 carry dated entries. It narrows [ADR-0040](0040-help-derives-compact-or-extended-from-the-spelling-the-operator-typed.md)'s clause that the compact page ends with its pointer to `--help`: the pointer is the compact page's last hint, and the epilogs follow it. ADR-0040's variant rule is unchanged, and it carries a dated entry. [ADR-0031](0031-a-plugin-supplies-facts-to-another-plugins-projection-through-a-collecting-extension.md)'s manifest supply is unchanged.

The glossary gains Epilog.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-09: Proposed with the contract for the help epilog (LM-392).
