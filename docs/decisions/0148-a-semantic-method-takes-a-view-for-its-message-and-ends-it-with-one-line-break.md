---
type: adr
title: ADR-0148 - A semantic method takes a view for its message and ends it with one line break
description: Each of the seven semantic methods takes an optional View<string> after its message. The method keeps its level, which is its destination and the verbosity it writes at, and the view replaces the lane view for that call and owns the whole layout. A semantic method ends its message with exactly one line break, appending one only when the view's text does not already end with one, so every pack view over a string is also a message view. The pack adds step(), and a note is box({ title }) written at a level.
status: proposed
created: 2026-11-13
modified: 2026-11-13
---

# ADR-0148 - A semantic method takes a view for its message and ends it with one line break

## Context

Each semantic method is a fixed pair of a level and a look. Its level is its destination and the verbosity it writes at, under [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md), and its look is its lane view, which an application replaces for every call in the run under [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md). An author cannot give one line an error look and still have `-q` hide it, or write a step or a note at `info`'s level without `info`'s glyph. Clack (`log.message` with a symbol, `log.step`, `note`) and consola (several looks at one level) keep the two apart, and both output seats of the 0.19.0 floor survey reported the coupling.

[ADR-0008](0008-rendered-output-is-a-neutral-call.md) keeps the semantic methods string-only, and [ADR-0027](0027-core-resolves-marked-output-and-one-theme-contribution.md) keeps that and makes each method append one newline. ADR-0008 rejected two shapes that would separate level from look: overloads on the semantic methods that accept a value and a view, because they blur "a message with a purpose" and "a value with a presentation", and a purpose parameter on `out.render`, because a rendered value is neutral.

Every pack view over a string, the heading, the rule, prose, and the box, ends each line it writes with `\n` under [ADR-0088](0088-pack-views-lay-out-lists-headings-rules-prose-and-boxes.md), and a lane view returns none. A message rendered through a pack view would print a blank line after it if the method always appended one.

## Decision

- **A view after the message.** `print`, `info`, `success`, `warn`, `error`, `debug`, and `trace` each take `(message: string, view?: View<string>)`. The message stays marked text, so a message is still a string with a purpose, and the view is any view over a string: a bare view, a declared view, or a pack view.
- **The method is the level.** The method keeps its destination, `print` moving to stderr from the action of a Command that declares a [result](../core/results.md) as before, and its verbosity. A call the verbosity hides calls no view, the passed one included.
- **The view is the look.** A passed view replaces the method's lane view for that call alone and owns the whole layout: the method adds no glyph, gutter, wrapping, or indent of its own. A declared view resolves through the application's and the plugins' overrides, as it does under `out.render`, and a bare view renders as it is. Without a view, the method renders through its lane view, so every existing call writes the same bytes.
- **One line break.** A semantic method ends its message with exactly one line break. It appends `\n` after the view's text unless that text already ends with a line break, judged on the text's characters with its style frames set aside, so a styled `\n` counts. A view that returns the empty string still writes one line break, as a lane override that returns the empty string does today. The rule applies to lane views and passed views alike, so there is one rule per write site.
- **`onEnvironment`'s `out`.** The `warn` an `onEnvironment` hook receives takes the same optional view.
- **A step view.** `@loomcli/plugins/step` exports `step()`, a view over a string: `glyph.pointer` styled `primary`, one space, then the message styled `bold`, wrapped at `columns` minus the measured gutter on a terminal with continuation lines indented under the message, as a lane wraps. It ends with `\n`, as the other pack views do.
- **A note is the box.** A note with a title is `box({ title })` written at a level, `out.info(text, box({ title: 'Next steps' }))`. The pack adds no `note()`, because it would be the box under a second name.

## Considered options

- **One `out.message(data, view, { level })`, with the seven methods kept as presets of it.** Rejected by the owner's ruling. It is both shapes ADR-0008 rejected at once, a value with a view on a message and a purpose on a neutral call, and it gives every level two spellings, `out.warn(text)` and `out.message(text, lanes.warn, { level: 'warn' })`, against principle 5.
- **A string-only `out.message(text, view, { level })` with the presets.** Rejected. It keeps ADR-0008's split but still gives every level two spellings.
- **Keeping the appended newline and shipping `step()` and `note()` as message views that return none.** Rejected by the owner's ruling. Every other pack view would print a blank line after it when passed to a message, and `note()` would duplicate `box({ title })` apart from its last `\n`.
- **The step look `glyph.lozengeOutline` in `primary` with the message plain (clack's), or a `dim` `glyph.arrowRight`.** Not chosen. From static mocks, the owner chose the pointer with a bold message, so a step reads as the heading of the lines under it.
- **A rail note (a `dim` `glyph.lineVertical` before each line) or a title line with the body indented.** Not chosen. The owner chose the framed note, which the box already draws.

## Consequences

`Out` changes in a feature fragment of `@loomcli/core`, and `@loomcli/plugins` gains the `step` subpath in a feature fragment. An action that passes no view writes the same bytes as before, except in one edge: a lane override whose text ends with a line break no longer prints a blank line after it, and the fragment states that.

The seven lane views keep their identities and their defaults, and an application still replaces one for every call through `views`. A passed view does not consult the lane's override, so a call that names its look keeps it whatever the application overrides.

This narrows ADR-0008's and ADR-0027's "string-only signatures" to a string message with an optional view of a string, and ADR-0027's "append one newline" to "end with one line break". ADR-0008's split between a message and a value holds: the message is a string, and a value still goes through `out.render`. Both records carry a dated entry. ADR-0021, ADR-0088, and ADR-0090 are unchanged.

The glossary's Semantic output and Lane view entries say that a call may pass its own view.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-13: Proposed with the contract for per-call message views and the step view (LM-370). It narrows ADR-0008's and ADR-0027's string-only signatures and ADR-0027's appended newline, each of which carries a dated entry.
