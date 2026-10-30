---
type: adr
title: ADR-0127 - A multiple option binds a variable whose value its author's delimiter splits into the list
description: A multiple string or content option may bind env when its declaration names envDelimiter, a non-empty string the types require beside env on a multiple option and reject everywhere else. The variable that supplies the option splits at each occurrence of the delimiter into the list, untrimmed, with empty items kept, and each item passes the option's validator. The list is the environment tier's fill, so it replaces the configuration source and the default and never joins them. The graph publishes the delimiter as envDelimiter, which the manifest copies and the man page prints beside the variables. This narrows ADR-0032's binding clause and withdraws its rejection of a list grammar for multiple options in the environment.
status: proposed
created: 2026-10-30
modified: 2026-10-30
---

# ADR-0127 - A multiple option binds a variable whose value its author's delimiter splits into the list

## Context

[ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md) lets no multiple option bind a variable, so its list comes from argv or the configuration source alone. It rejected "a list grammar for multiple options in the environment" because "every separator is a character some value holds, and the configuration source already carries lists as lists". The types carry the bar: a multiple option's declaration takes no `env`, and core holds no runtime check for it, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md).

Command-line parsers in the ecosystem bind a list to a variable, and CI configuration sets one, such as `FIELDS=name,size`. clap splits a variable only with a `value_delimiter` its author declares, and keeps empty segments. Click and Typer split on the type's splitter, whitespace by default, and drop empty segments. Viper's `GetStringSlice` splits on whitespace, and its `Unmarshal` hook splits on commas and keeps empty segments. Commander does not split. Every one of them replaces the lower tiers with the list rather than joining them.

The owner ruled that the author declares the delimiter, as clap does, and that the types require one whenever a multiple option binds a variable. That answers ADR-0032's objection: the author knows which characters the option's values hold and picks a delimiter none of them holds.

## Decision

- **The author declares the delimiter.** A multiple string option and a multiple content option may bind `env`, one name or a non-empty list, when the declaration also names `envDelimiter`, the string that separates the items. The types require `envDelimiter` beside `env` on a multiple option, and reject it on a multiple option that binds no variable and on every option that is not multiple. Core derives no default delimiter. An empty `envDelimiter` is a declaration error at the declaring call, `@loomcli/core/env-delimiter`, as an empty declared name is.
- **The value splits at each delimiter.** The variable that supplies the option is found as for every binding: the first name in list order that holds a non-empty value, and an empty variable is unset. Its value splits at each occurrence of the delimiter, matched literally from left to right, and each piece is one item, in order. `FIELDS=name,size` fills `['name', 'size']`, and a value that holds no delimiter fills a list of one item. No item is trimmed, and no character escapes the delimiter: an item that holds it is supplied through argv or the configuration source.
- **An empty item is kept.** A delimiter at either end of the value or beside another fills an empty item in its place, so `FIELDS=name,` fills `['name', '']`, as clap keeps one. Each item passes the option's validator under [ADR-0036](0036-each-value-passes-the-same-validator.md), so a validator that rejects an empty value rejects a stray delimiter, and the failure names the variable and the item's position, counted from 0: `Option "--field" (from FIELDS) at 1: Supply a field name.` A content option reads each item as a path, as it reads the path a variable supplies to a scalar content option.
- **The list replaces the lower tiers.** The variable's list is the environment tier's one fill, so the configuration source is never asked for the option and the default never applies, and the list never joins either of them. Occurrences in argv still supply the option first. ADR-0032's precedence stands. A non-empty variable fills at least one item, so it satisfies `required` and a content option's `min` and `max` count its items as they count argv's sources.
- **The delimiter is published beside the names.** The string and content variants of `OptionNode` gain `envDelimiter`, the declared delimiter, or `null` when the option declares none. The manifest copies it after `env`. The man page prints it after the variables of an option entry's `Environment:` line, `Environment: FIELDS (a list separated by ",")`, and its ENVIRONMENT entry for each of the option's variables reads `Supplies --field as a list separated by ",".`. The page writes the delimiter as a JSON string literal, so a tab reads `"\t"`.

## Considered options

- **A default delimiter, such as a comma.** Rejected by the owner's ruling. A default is a separator the author did not choose, which ADR-0032's objection names: some value holds it.
- **The list joins the configuration source's list or the default.** Rejected. Every parser surveyed replaces the lower tiers, and under ADR-0032 the first tier that supplies a value wins.
- **Empty items dropped, as Click and Typer drop them.** Rejected. A dropped item hides a stray delimiter from the validator, and clap, whose declared delimiter this record follows, keeps them.
- **Items trimmed of surrounding whitespace.** Not taken. The Boolean and counted grammars read the whole value untrimmed, and a validator that wants a trimmed item trims it.
- **A key named `delimiter`.** Not taken. clap's `value_delimiter` also splits a value typed in argv, and argv already separates a multiple option's values by occurrence, so the key's name keeps the delimiter to the environment binding.

## Consequences

The types widen `Multiplicity` and the content option's multiple branch: a multiple option binds `env` beside `envDelimiter`. A declaration that compiled before still compiles and runs the same, so no application changes its code. The input-source stage reads a multiple option's variable as a list, and its diagnostics gain the item's position. `OptionNode` and the manifest's option entry gain `envDelimiter`, an addition to objects core and the manifest build, and the man page's binding lines name the delimiter. Core gains one declaration rule. [Input sources](../core/input-sources.md), [Graph inspection](../core/graph-inspection.md), [Declaration faults](../core/declaration-faults.md), [Diagnostics reference](../core/diagnostics.md), [Manifest plugin](../plugins/manifest.md), [Man pages plugin](../plugins/manpage.md), and the [glossary](../glossary.md) carry the contract.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-10-30: Proposed with the contract. It narrows ADR-0032's environment binding clause that a multiple string option cannot bind, and withdraws ADR-0032's rejection of a list grammar for multiple options in the environment, for a delimiter the author declares. ADR-0032 carries a dated entry.
