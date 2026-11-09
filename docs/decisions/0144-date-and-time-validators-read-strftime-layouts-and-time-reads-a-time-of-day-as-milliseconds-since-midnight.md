---
type: adr
title: ADR-0144 - Date and time validators read strftime layouts, and time() reads a time of day as milliseconds since midnight
description: '`date()` and `dateTime()` take `layouts`, POSIX strftime layouts with no locale-dependent directive, tried in order after their default grammar, the first match winning, and parsed as `strptime` defines; a date read through a layout outputs `YYYY-MM-DD`. A new `time()` reads an RFC 3339 partial time, or its own layouts with 12-hour directives, into milliseconds since midnight, with bounds in its own grammar. A layout that lacks a required field or holds an unsupported directive is a declaration fault under one new rule. This supersedes the validators reference''s listing of custom date layouts as not shipped.'
status: proposed
created: 2026-11-09
modified: 2026-11-09
---

# ADR-0144 - Date and time validators read strftime layouts, and time() reads a time of day as milliseconds since midnight

## Context

`date()` reads `YYYY-MM-DD` alone and `dateTime()` reads ISO 8601 and RFC 3339 forms alone, and the [validators reference](../libs/validators.md#not-shipped) listed custom date layouts as not shipped. An operator types `25/09/2026` or `20260925` as often as the ISO form, and an author whose operators do so writes a parse by hand. A time of day, as in `--at 09:30` or `--quiet-from 22:00`, has no factory at all.

Among the frameworks Loom compares itself with, Click ships layouts as a list of strftime formats tried in order, `click.DateTime(formats=[...])`; clap, Cobra, and oclif leave layouts to the language's own date parser. [Principle 6](../principles.md#6-standards-before-inventions) points at POSIX strftime, the layout language a Unix operator and a Click author already know, and at POSIX `strptime` for how a layout reads a token.

## Decision

- **Layouts are strftime.** `date`, `dateTime`, and `time` take `layouts`, a nonempty list of POSIX strftime layouts. Each factory accepts its default grammar first and then each layout in the declared order, and the first that reads the token wins, so the author's order resolves a token two layouts could read. A layout reads a token only when the token matches it and every field is in range; otherwise the next layout is tried, as Click's are. No directive reads a month or day name, so no layout depends on a locale: `%Y` reads four digits; `%m`, `%d`, `%H`, `%M`, `%S`, and `%I` read one or two digits, leading zeros permitted but not required, as `strptime` reads them, except that a directive followed directly by another digit-reading directive reads exactly two, so `%Y%m%d` reads `20260304` one way; `%z` reads an offset as `Z`, `z`, `+hh`, `+hhmm`, or `+hh:mm`, or with `-`; `%p` reads `AM` or `PM` in any letter case, as the C locale writes them; and `%%` reads a percent sign. Every other character matches itself.
- **Each factory names its directives and required fields.** A `date` layout holds `%Y`, `%m`, and `%d` once each and no other directive. A `dateTime` layout holds those and `%H` and `%M` once each, and may hold `%S` and `%z` once each. A `time` layout holds `%M` once and either `%H` or `%I` with `%p`, once each, and may hold `%S` once. A `dateTime` layout holds no literal `Z` or `z`, which would read a UTC stamp as local time; `%z` reads it. A layout that breaks its factory's rule, an empty layout, and an unknown directive throw a declaration fault under `@loomcli/validators/layout`.
- **A layout reads into the factory's own output.** `date()` outputs `YYYY-MM-DD` whichever form the token took, so the action reads one form. `dateTime()` outputs a `Date`: a layout with `%z` names that instant, and one without reads the local time in `timeZone` or `host.timeZone` under the existing rule for a clock change. Every read date names a real day under `date()`'s rule.
- **`time()` reads a time of day.** `time({ min?, max?, layouts? })` reads RFC 3339's partial time by default, with seconds optional as ISO 8601 writes a local time: two-digit hours from 00 through 23, a colon, two-digit minutes, then optional `:ss` and, after seconds, an optional fraction. A leap second, `24:00`, and an offset are rejected, because a zoned time is `dateTime()`'s. `%I` reads 1 through 12, and `12AM` is midnight and `12PM` noon. The output is the number of milliseconds since midnight, the unit `duration()` uses, a fraction beyond milliseconds truncated. `min` and `max` are times in the default grammar, both inclusive, and a range that wraps past midnight is a `pipe` step.
- **Published schemas stay sound.** A factory with layouts publishes an `anyOf` of its default schema and each layout's pattern. `time()` publishes a pattern, not `format: 'time'`, which requires an offset the validator rejects.
- **Messages name the layouts.** A factory with layouts answers one sentence that lists each distinct form it accepts, its default grammar's first and each layout written as its directives read, such as `DD/MM/YYYY`; when it has bounds, it answers its bounds sentence alone. Each sentence carries one issue code under [ADR-0048](0048-a-validator-package-declares-one-issue-code-per-sentence.md).

The directives, grammars, sentences, and codes are the contract in the [validators reference](../libs/validators.md#catalog).

## Considered options

- **Go's reference-time layouts, such as `02/01/2006`.** Rejected. Only Go programmers know the reference date, and its digits read as a day-first date to everyone else.
- **Unicode and ICU patterns, such as `dd/MM/yyyy`.** Rejected. Their case-sensitive vocabulary, `MM` against `mm` and `yyyy` against `YYYY`, is easy to get wrong, and month names bring locales.
- **Named orders, such as `date({ order: 'DMY' })`.** Rejected. They cannot express `%Y%m%d` or a separator of the author's choice.
- **A declaration fault for layouts that can read one token two ways.** Rejected. Detecting it in general is hard, and it refuses reasonable lists; the first match wins, as in Click.
- **`time()` output as `{ hours, minutes, seconds }`.** Rejected. Milliseconds since midnight compare directly and add to a `duration()` value.

## Consequences

- The catalog holds eighteen factories, and the validators reference's not-shipped list no longer names custom date layouts.
- A layout is a contract an author states once, and help and the manifest publish what it accepts through the schema.
- ADR-0037 carries a dated entry for `time()` and the layouts.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-09: Proposed with the contract for layouts and `time()` (LM-487). It supersedes the validators reference's listing of custom date layouts as not shipped, and ADR-0037 carries a dated entry.
