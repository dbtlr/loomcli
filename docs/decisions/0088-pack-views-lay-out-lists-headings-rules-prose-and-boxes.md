---
type: adr
title: ADR-0088 - Pack views lay out lists, headings, rules, prose, and boxes
description: The plugin pack adds five pack views beside the table and records. The list is a whole view over items with nested children. The heading, the rule, prose, and the box are views over a string that take marked text their author owns. A box can frame another view, which it renders with columns narrowed by its frame. Off a terminal nothing wraps, and the rule alone draws a length of its own, 80.
status: proposed
created: 2026-10-18
modified: 2026-10-18
---

# ADR-0088 - Pack views lay out lists, headings, rules, prose, and boxes

## Context

The original renderer catalog listed a list, a heading, a rule, prose, and a box beside the table and the records list. [ADR-0021](0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) retired the renderers package for one registry of views, and the pack shipped the table and the records list as pack views. The other five were not shipped. An action that wants a section heading, a separator, a wrapped paragraph, or a framed summary writes its own view, measures the screen itself, and draws its own glyphs.

[ADR-0086](0086-renders-fit-the-destinations-live-columns-and-tables-shrink-to-fit.md) gave every view the destination's live `columns`, with `wrap`, `expandTabs`, `nowrap`, and `splitLines`, and left the fallback width to each view. Four of the five views lay out to that width, and the rule cannot be drawn without one.

## Decision

The pack ships five pack views, each at its own subpath, `@loomcli/plugins/list`, `/heading`, `/rule`, `/prose`, and `/box`. Each factory returns a bare view, installs nothing, and publishes nothing, the pack view rule the table and the records list follow. Each reuses core's width primitives and measures nothing on its own.

### The list is a whole view over items

`list<Item>(config?)` returns `View<readonly Item[]>`, so it serves a `rows<Item>()` result and `out.render` alike. It is a whole view because an ordered list right-aligns its numbers against the widest one among its siblings, which a row view cannot know. Its text comes from `format`, or from `style.escape(String(item))` by default, the table's cell rule. Nesting comes from a `children` accessor over the author's own item type, so the item type stays the type the result declares. A nested list starts at its parent's text column, a nested ordered list counts from 1, and every continuation line hangs under the item's text.

### Four views take a string

`heading(config?)`, `rule()`, `prose()`, and `box(config?)` without content each return `View<string>`. The string is marked text its author owns, as a lane view's message is: the view does not escape it, so a styled word keeps its style, and raw data goes through `style.escape` first. Each view writes whole lines and owns its trailing newline, and none writes a blank line around itself, so spacing between renders is the action's. The rule reads its string as a label, and the empty string draws a bare line.

### A box frames text or a view

`box<Data = string>(config?)` takes an optional `content` view and returns a view over that view's data. It calls the content's view function with a context that matches its own except for `columns`, which it narrows by its frame, so a framed table shrinks or falls back to the records layout inside the box. The content is called as given, so a declared view's override does not apply inside a box, the rule a bare view follows under `out.render`. The parameter type requires a configuration with `content` whenever `Data` is not a string, so a text box cannot be declared on a result whose value is something else.

### The width rule

On a terminal, a list, a heading, prose, and a box's text wrap to `columns`, a box is as wide as its content and never wider than `columns`, and a rule spans `columns`. A unit `wrap` keeps whole, a box's title, and a content view that ignores `columns` may overflow, as a records label may. Off a terminal nothing wraps, tabs stay as written except inside a box's padded lines, and nothing is cut. The rule draws 80 off a terminal: a length of the rule's own, not a fallback width in the view context, which ADR-0086 leaves to each view.

### Printed form

Structure is `dim`: markers, underlines, rules, and box borders. A bullet is `glyph.bullet`. Both heading levels are `dim` and unindented, and level 1 adds an underline of `glyph.line` as wide as its text. The rule's label sits on the left after two line glyphs. The box draws rounded corners, `glyph.lineDownRightArc` and its kin, with the title in the top border, styled `primary` and `bold`.

## Considered options

- **The list as a row view.** It would stream, but it could not align ordered markers without the count.
- **A fixed item shape `{ text, children }`.** It is simple, but a `rows<Member>()` result could not name the list without mapping its rows first.
- **The rule as `View<undefined>`.** It is honest about taking no data, but `out.render(undefined, rule())` reads badly, and a label has nowhere to go.
- **A text-only box.** Framing a table would then need core to render a view into a string inside an action, a larger change to core.
- **A general composition view.** Calling `out.render` several times in a row already composes a heading, a table, and a rule.
- **A label-only rule off a terminal.** It is honest about the unknown width, but a log or a file loses the visual break. Rich draws 80 off a terminal, and so does the rule.
- **Bold or copper level 1 headings, or an indented level 2.** Headings are wayfinding, so both stay `dim`, and an underline separates the levels by shape, which reads the same with color and bold off.

## Consequences

- An application imports each view from its own subpath, so it bundles only the views it names, and the pack has five more entry points to publish and lint.
- The private `@loom/doctor` plugin depends on `@loomcli/plugins` to render its report, so the example that teaches plugin Commands also shows a plugin rendering through pack views.
- An override of a declared view does not reach it inside a box, so an application that replaces a declared view and frames it renders the original inside the frame. Framing the replacement means passing the replacement's view as `content`.
- Help's Details lists and headings print in these views' forms, through the marker layout and heading underline that `text-lines` shares with the list and the heading: a `dim` `glyph.bullet`, numbers that right-align against the widest sibling, and `dim` headings with an underline at level 1, on a terminal and off one. One look for lists and headings holds across Loom, and no second implementation exists.

## Status

Proposed. It moves to accepted with the release that ships the five pack views. Tests prove each view as the second argument of `out.render` and in a declared result, the list's markers, nesting, and hanging lines, both heading levels and the underline, the rule bare and labelled at a fixed width and at 80 piped, prose paragraphs, a text box and a framed table that shrinks and falls back to records, the width read again after a resize, byte-identical piped output, and the negative type checks.

## Changelog

- 2026-10-19: Amended before acceptance: help's Details lists and headings print in the list and heading views' forms through the shared `text-lines` helpers, which replaces the consequence that help kept a `-` bullet, numbers that do not right-align, and `primary` `bold` headings.
