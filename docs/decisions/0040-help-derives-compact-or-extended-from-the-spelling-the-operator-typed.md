---
type: adr
title: ADR-0040 - Help derives compact or extended from the spelling the operator typed
description: A middleware reads the spelling that supplied each of its own plugin's typed options, and help derives its variant from it, so -h prints a compact page and --help an extended page that adds details and examples. Core supplies no variant fact. This narrows the ADR-0032 clause that nothing publishes where a value came from.
status: proposed
created: 2026-09-26
modified: 2026-09-26
---

# ADR-0040 - Help derives compact or extended from the spelling the operator typed

## Context

Help declares one Boolean option, `help`, with the short spelling `h`, and prints one page for both spellings, with the details and examples always present. Common command-line tools answer the two spellings differently: `-h` orients a reader who needs the syntax, and `--help` teaches. Loom's earlier help design made the same split and derived the variant in the help plugin from the spelling that selected the option, with core supplying no variant fact.

Core cannot support that today. The parser resolves each token to a spelling only to find the option, stores the option's value, and discards the spelling. [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) also holds that where a value came from is internal to core's failure messages and that nothing publishes it, and it defers the question of an environment binding on the help page to the contract that defines extended help.

## Decision

- **Spellings reach a middleware.** The middleware context gains `spellings`: for each of the plugin's own options that the invocation supplied as a token, the spelling that supplied it, such as `-h`, `--help`, or `--no-total`, without any attached value. A repeated option other than a multiple string option is already a usage error, so it has one spelling, and a multiple string option records its last. An option filled by the environment or the configuration source, or left to its default, has no entry. A plugin reads the spellings of its own options alone, as it reads their values under `options`.
- **The context, not the request.** `spellings` sits beside `options` because help renders while `request` is `null` under a held local fault, as `jsonkit select --bogus --help` does.
- **Help derives the variant.** `-h` selects the compact page, and every other case selects the extended page: `--help`, and an option supplied without a spelling. Core supplies no variant fact and knows nothing of help.
- **One view.** `HelpPage` gains `variant: 'compact' | 'extended'`, and `helpPage` stays the one declared view, so a replacement reads the variant and never reads spellings.
- **Compact orients.** The compact page is the extended page without the details and EXAMPLES blocks. It ends with a pointer to `--help` when the extended page holds something the compact page omits, and its hint to the children spells `-h`.
- **Extended teaches.** The extended page is the page help prints today.
- **Help teaches syntax.** Help prints no environment binding and no configuration binding on either page. A variable or a configuration file belongs to the documentation, such as a man page, and `inspect()` and the manifest already publish `env`.

## Considered options

- **Two options, a long-only `help` and a short-only `h`.** Rejected. It needs no core change, but it prints two rows for one request, puts a parser detail into the graph and the manifest as two options, and departs from the tools operators already know.
- **Spellings on `Request`.** Rejected. `request` is `null` under a held local fault, which is where help must still render.
- **Core resolves a variant fact for help.** Rejected. Core would carry a help concept, and a replacement help plugin could not choose its own mapping.
- **Spellings for every option in scope.** Rejected. A plugin has no need to read how the operator typed the application's options, and the narrower grant keeps the ADR-0032 principle for everything a plugin does not own.
- **Two declared views, one per variant.** Rejected. They would share nearly all of their layout, and an application that replaces help would replace both.
- **An ENVIRONMENT block on the extended page.** Rejected. It turns help into documentation, and a row for a Boolean that can only be switched off needs a sentence per polarity to stay true.
- **Configuration bindings on the extended page.** Rejected for the same reason.
- **A description on the help option that advertises both spellings.** Rejected as not worth the change to every page.

## Consequences

`MiddlewareContext` gains one read-only member and `HelpPage` gains one, so an existing middleware and an existing help replacement compile unchanged. `-h` prints fewer lines, and `--help` prints what it printed before. That is an output change, not a breaking change.

The ADR-0032 clause that nothing publishes provenance now reads as: nothing publishes which tier supplied a value, except that a middleware sees the spellings of its own plugin's typed options, which a fill never has. A fill stays an alternative to giving the option: help treats a fill as `--help`. The action, the request, and the graph still cannot tell which tier supplied a value.

This answers one part of the question [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md) left open, how facts about the request beyond the parsed values reach a middleware, for one fact. How request facts reach actions stays open.

## Status

Proposed with the [help variants](../core.md#help-variants) contract. It is accepted when the implementation proves the acceptance there under Node and Bun.

## Changelog

- 2026-09-26: Proposed with the help variants contract.
