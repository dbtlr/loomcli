---
type: adr
title: ADR-0138 - Select and multiselect questions offer choice objects, may search them or read them from a source, and draw choice rows
description: A select question's choice is a string or an object with a value, a label, an optional description, and an optional disabled state, and a separator entry may sit between choices. An unlinked question's values may be any type, and a linked question's are strings. A fifth kind, multiselect, takes the same choices, toggles them with Tab always and with Space when it does not search, submits them in selection order with Enter between min and max, and links a multiple string option or a variadic string argument. A linked select or multiselect that asks passes each chosen value through its input's own validator, and a supplied value it cannot select is named in its issue rather than dropped. Either kind searches its static choices with search true or reads them from an author's source function, whose previous call each keystroke aborts, with no debounce timer; the answer is always a choice. The question frame keeps one view, and its select data becomes choice rows shared with multiselect, which breaks a view override that read a choice as a string. This narrows ADR-0082's four kinds, its exports, its link clause, and its validation clause, and decides the several-value link ADR-0136 left open.
status: proposed
created: 2026-11-04
modified: 2026-11-04
---

# ADR-0138 - Select and multiselect questions offer choice objects, may search them or read them from a source, and draw choice rows

## Context

[ADR-0082](0082-an-action-asks-through-the-prompts-library-and-one-interaction-decision-governs-questions-and-conditional-requiredness.md) gives an action four question kinds, and its select offers a list of strings that are both what the frame draws and what the question returns. Three needs fall outside it.

- **A label beside a value.** An application that asks for a storage backend returns `postgres` and wants to draw `PostgreSQL`, with a line saying what it is, and it wants to show a choice it cannot offer yet, with the reason. An action that picks an enum member or a record wants the member or the record back, not a string it maps again.
- **Several answers.** A wizard asks which features to turn on, and a multiple string option such as `--feature` is the input that answers it. [ADR-0136](0136-a-multiple-string-option-or-a-string-argument-may-be-required-only-when-input-is-not-interactive-and-a-question-may-link-an-argument.md) made such an option and a variadic argument conditionally required, and left the link to a question kind that answers several values.
- **A long or remote list.** A list of countries, repositories, or files is too long to scroll seven rows at a time, and some lists live behind a service the action queries as the operator types. The prompts reference names the question that narrows its choices as the operator types as not shipped.

Several facts already fit the change.

- **One frame view.** Every question draws through one declared view, `questionFrame`, whose data is a union by `kind`, so a new kind joins the union.
- **A typed line.** The line editing, the key table, and bracketed paste that shipped beside ADR-0136 give every key a search term needs, and they left Escape without a meaning, to clear a search.
- **The run signal.** A question already ends through the run signal, the region's signal, and its own listeners, so it can abort the author's call when it ends.
- **Per-value validation.** Under [ADR-0036](0036-each-value-passes-the-same-validator.md), a multiple option's or variadic argument's validator checks one value at a time, so a skipped question that links one returns a list whose values each passed.

## Decision

- **A choice.** A choice is a string, shorthand for a choice whose value and label are that string, or an object: `value`, what the question returns; `label`, what the frame and the answered line draw, which may be omitted exactly when `value` is a string; an optional `description`, drawn under the list while the choice is highlighted; and an optional `disabled`, `true` or a reason string, which draws the choice dimmed with its reason and keeps navigation off it. Labels, descriptions, reasons, and separator text are plain text, drawn as `escapeControlCharacters` writes them, in the frame and in the answered line, and measured in that form. A static search matches the raw label.
- **A separator.** `{ separator: text }` sits between choices as a dimmed row that is never highlighted, selected, or returned. It is a plain object, not a class instance, so a source returns it as data and a list needs no import. A choice or a separator is a `ChoiceEntry`, and `Choice` names a choice alone, because a separator is not one.
- **Values and types.** An unlinked question's values may be any type, and the answer is the chosen choice's `value` itself. A linked question's values are strings, because a supplied value is a string, and the types reject any other. An unlinked `default` matches its choice with `Object.is`, and a linked default or supplied value matches by string value. The question infers the type of one entry of its list under `const` inference, and `ChoiceValue` reads the answer's values from it, so string shorthand beside choice objects, and values of different types beside each other, infer the union of their values, and an explicit type argument such as `select<Options, 'a' | 'b'>` keeps compiling.
- **Multiselect.** A fifth kind, `multiselect`, takes the same choices and settings as select, with `min`, 0 by default, and `max`, none by default. Without a search, Space toggles the highlighted choice, and Tab toggles it too, so one key toggles at every multiselect. With a search, Tab toggles and Space types into the term. Enter submits the selection in the order the operator toggled its choices on, for static choices and a source alike. Enter below `min` keeps asking with Loom's issue `Choose at least 1.`, and at `max` a choice outside the selection draws dimmed and cannot be toggled in. A multiselect takes no `validate`: no whole-list validator runs.
- **Its link.** A multiselect links a multiple string option or a variadic string argument, under the same resolution as every linked question: the raw tokens preselect the choices they match, each once, a skipped question returns the input's validated list, each value of which passed the input's own validator under ADR-0036, and with interaction off an omitted input is core's missing-input error. A collected input is supplied when its raw list is not empty, and an empty raw list is no prefill, so the question's `default` and then the declared default apply.
- **A linked answer passes the input's validator.** A linked select or multiselect that asks passes each chosen value through the linked input's own validator, one value per call as ADR-0036 has it, with the options `questionValidationOptions` builds for the linked input, through a core function, `validateLinkedValue`. Those options' `supplied` is the run's copy of its supplied inputs, so it holds the raw value the operator supplied for the linked input, never the selection, and a validator there cannot read the other chosen values as ADR-0036's invocation phase lets it. The function's result types each output as one element of the input's value, and it reads the validator from the build behind a graph `inspect()` rendered, so a context whose graph core did not render throws `@loomcli/core/foreign-graph` rather than pass the value unvalidated. A rejection draws its issue and keeps asking with the selection kept, and the answer is the validators' outputs. So asked or skipped, a linked question's answer is its input's validated value, and its type is the input's value type. An asked linked select of ADR-0082 returned the chosen string unvalidated, so this changes select too, and both kinds answer alike.
- **A supplied value is never dropped in silence.** A raw supplied value that preselects nothing, because it matches no choice, matches a disabled choice, or falls past `max`, is named in the issue the first frame after the prefill resolves draws, `Cannot select "mysql". Choose from the list.`, or, for a value in the list that falls past `max`, `Cannot select "neon": at most 3 can be selected. Deselect a choice to select it.` Under a source, the prefill matches the first call that settles without going stale, and each supplied value that result lacks is looked up once by calling the source with the value as the term and matching exactly: a multiselect selects the match, and a select opens with the value as its term and the match highlighted. While the prefill of a supplied input resolves, keys wait.
- **Search.** A select or multiselect with `search: true` filters its static choices by a case-insensitive substring of the label, in authored order, and drops separators while a term is typed. One with `source: (term, { signal }) => entries | Promise<entries>` searches always and shows what the source returns. Each change to the term calls the source and aborts the previous call's `signal`, and a stale call's result or rejection is discarded. Loom adds no debounce timer, under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write). The list changes at each change to the term under static search and at each call that settles without going stale under a source, and then the highlight moves to its first choice that is not disabled. The term is a typed line on the question's first line, and Escape clears it. The answer is always a choice: no free-text answer exists, and no separate autocomplete kind.
- **Keys wait for the list.** A navigation key, a toggle, or Enter that arrives while the latest source call is pending waits for it to settle, so typeahead acts on the list for the term typed before it, and a test that types a term and Enter in one read is deterministic.
- **A failing source.** The source is author code. When its latest call or a lookup throws or rejects, the question draws its cancelled line and rejects with the same error, which takes the ordinary failure path.
- **One frame view.** `questionFrame` stays one view. Select's frame `choices` becomes a list of choice rows and separator rows, which multiselect shares, `highlighted` may be `undefined`, and the select member gains optional `term`, `cursor`, and `loading`. The multiselect member joins the union with `count`, `min`, and `max`, and a row `max` keeps out is not `disabled`, which a view tells by `count` reaching `max`. The text, secret, and confirm member is exported as `TypedFrame`.
- **Navigation.** Up and Ctrl-P, and Down and Ctrl-N, move the highlight over choices that are not disabled, and Home and End, which the reader also reads from Ctrl-A and Ctrl-E, jump to the first and last when the question does not search. The highlight stops at either end and never wraps, as ADR-0082's select does, and at either end the window reaches the list's first or last row.

The contract is in the [prompts reference](../libs/prompts.md#choices).

## Considered options

- **A separate autocomplete kind.** Rejected. It would duplicate select's choices, frame, link, and keys for one difference, whether the list filters, under [principle 5](../principles.md#5-one-system-per-concept). A setting on select and multiselect covers it.
- **A free-text answer when no choice matches.** Rejected. The answer type would become the choices' union or a string, and a linked question would return what no validator saw. A text question takes free text.
- **A debounce timer on the source.** Rejected under principle 1. The library already aborts each superseded call, and a source that should wait for a pause waits on its own signal.
- **A `Separator` class, as Inquirer exports one.** Rejected. A plain entry is data a source can build without an import, and the discriminating key is enough for the types.
- **A frame view of its own for multiselect.** Rejected. One view, as ADR-0082 has it, lets an override restyle a choice row in both kinds, and the union already discriminates by `kind`.
- **Space toggles in a search too.** Rejected. A term could hold no space. Tab toggles there, as fzf's multi-select toggles.
- **Space alone toggles without a search.** Rejected. Tab costs nothing there, because a list that does not search has no question hint to copy, and an operator who learned Tab in a search keeps one key that works at every multiselect.
- **An asked linked question returns the chosen value unvalidated.** Rejected. The answer would be a value no validator saw, of a different type than the skipped path returns, so the author would validate it twice or not at all.
- **Match a supplied value against the first result alone.** Rejected under [principle 1](../principles.md#1-loom-owns-what-it-ships-the-author-owns-what-they-write). A source's first result is often a page, so a valid value the operator supplied would open unselected, and Enter would answer without it.
- **Keep an unmatched supplied value as a row of its own.** Rejected. The answer would no longer always be a choice, and a source that does not return the value is saying the value is not one.
- **A key that selects every choice.** Rejected. Ctrl-A starts the line in a term, a letter types into it, and "every choice" is undefined under `max` and disabled choices.
- **Static search that matches descriptions or ranks fuzzily.** Rejected for the default. A substring of the label in authored order is predictable, and a source matches however its author chooses.
- **Wrapping navigation.** Rejected. ADR-0082's select does not wrap, and nothing here needs it to.

## Consequences

- `@loomcli/prompts` exports `multiselect`, `MultiselectSettings`, `Choice`, `ChoiceEntry`, `ChoiceObject`, `Separator`, `ChoiceSource`, `ChoiceValue`, and `ChoiceAnswer`, and `@loomcli/prompts/views` exports `TypedFrame`, `ListFrame`, `ChoiceRow`, and `SeparatorRow`. `SelectSettings` gains `search` and `source`, its `choices` accepts choice objects and separators, and its second type parameter becomes the entry type. A string is its own entry, so a call that passes type arguments keeps compiling.
- `@loomcli/core` exports `validateLinkedValue` and its types, `LinkedValue`, `LinkedValueContext`, `ValueLink`, and `LinkedOutput`, which [Validation](../core/validation.md) states, compatible additions.
- The rule `@loomcli/prompts/link` gains the multiselect link, the check that static choices offer one that is not disabled, and the checks on `min` and `max`, and its explanation reads `A question asks in one line of prose and links at most one local option or argument of the routed Command, of the kind the question accepts, and a select or multiselect question offers enough choices that are not disabled to be answered.`, which replaces the explanation ADR-0136's consequences state. [Diagnostics](../core/diagnostics.md) is generated from the rule declarations, so the implementer changes the explanation in source.
- The glossary gains Choice, Separator, Search term, Choice source, and Selection, and Question, Linked input, and Typed line widen.
- **Breaking changes.** A view override of `questionFrame` that reads a select's `choices` as strings, or `highlighted` as always a number, no longer compiles or draws a label, because each row is an object and a search may highlight nothing. Data an application builds by hand for `out.draw(data, questionFrame)` with string choices breaks the same way. A linked select that asks now answers the linked option's or argument's validated value, typed as that input's value, so code that compared the answer with a choice string under an option whose validator transforms its value no longer compiles or matches. A linked select whose input's validator rejects one of its choices, such as `oneOf(['sqlite', 'postgres'])` beside a `mysql` choice or `path()` that checks a file exists beside a choice for one that does not, used to return that choice's string when the operator chose it, and now keeps asking with the validator's issue. `SelectSettings` becomes a union of a `choices` list and a `source`, so its `choices` is optional, and a wrapper that reads `settings.choices.length` from a `SelectSettings` value no longer compiles. A unit test that calls an action asking a linked select through `actionContext` with a graph `inspect()` did not return, or that links an argument without a `graph`, now throws when the question validates its answer, because core reads the validator from the build behind that graph; a test that links an option without a `graph` already threw at the link check.
- **One fragment.** The [changelog rules](../../.changes/README.md) take one fragment per PR, so the implementing PR adds one `breaking.` fragment, `.changes/breaking.choice-objects-multiselect-search.md`, that carries the additions and the breaking changes together, with this text:

  ````markdown
  - Add `multiselect`, a question that offers the same choices as `select`, toggles them with Tab always and with Space when it does not search, submits them in the order they were selected between `min` and `max`, and links a multiple string option or a variadic string argument.
  - Add choice objects to `select` and `multiselect`: a `value` of any type on an unlinked question, a `label`, a `description`, and a `disabled` state with its reason, beside `{ separator }` entries.
  - Add `search: true`, which filters a question's static choices as the operator types, and `source`, a function that returns the choices for a search term and whose previous call each keystroke aborts.
  - Add Ctrl-P, Ctrl-N, Home, and End to a select's navigation, and draw a supplied value a question cannot select in its issue instead of dropping it.
  - Add `validateLinkedValue` to `@loomcli/core`, which runs a linked input's validator on one value with the question's validation options, and its types `LinkedValue`, `LinkedValueContext`, `ValueLink`, and `LinkedOutput`.
  - Change a linked `select` that asks to pass the chosen value through the linked input's validator and return its output, typed as the input's value, as a skipped `select` already returns. A choice the validator rejects now keeps the question asking with the validator's issue, where it used to return the choice's string, and a test that asks one through `actionContext` states a `graph` that `inspect()` returned.
  - Change `SelectSettings` to a union of a `choices` list and a `source`, so its `choices` is optional.
  - Change the `select` member of `questionFrame`'s data to choice rows and separator rows, which the new `multiselect` member shares, with a `highlighted` that may be `undefined`, export `TypedFrame`, `ListFrame`, `ChoiceRow`, and `SeparatorRow` from `@loomcli/prompts/views`, and add the question's `kind` to `answeredLine`'s data, so the default view draws an empty multiselect answer as `none`.

  ### Migration

  **Affected surface.** A view override of `questionFrame` from `@loomcli/prompts/views` that reads a select's `choices` or `highlighted`, frame data an application builds by hand for `out.draw(data, questionFrame)`, an action that reads the answer of a `select` with `option` or `argument` whose input declares a validator that transforms its value, a `select` with `option` or `argument` that offers a choice its input's validator rejects, code that reads `choices` from a `SelectSettings` value, such as a wrapper around `select`, and a unit test that calls an action asking a linked `select` through `actionContext` without a `graph` from `inspect()`.

  **Why.** A choice row carries a label, a description, a disabled state, and a selection, and one row type serves both list kinds. A search may leave nothing highlighted. A linked question's asked answer passes the same validator as its skipped answer, so both have one type, and a choice that validator rejects can no longer answer. A question with a `source` has no `choices`.

  **Before and after.**

  Before, in a `questionFrame` override:

  ```ts
  if (data.kind === 'select') {
    return data.choices.map((choice, index) => (index === data.highlighted ? `> ${choice}` : `  ${choice}`)).join('\n');
  }
  ```

  After:

  ```ts
  if (data.kind === 'select' || data.kind === 'multiselect') {
    return data.choices
      .map((row, index) => {
        const label = escapeControlCharacters(row.label);
        return row.kind === 'separator' ? `  ${label}` : `${index === data.highlighted ? '>' : ' '} ${label}`;
      })
      .join('\n');
  }
  ```

  **Steps.**

  1. In a `questionFrame` override, read each row's `kind` for a `select` or `multiselect` frame: draw a `'separator'` row's `label` as a separator, and a `'choice'` row's `label` where the string was drawn, with its `disabled`, `reason`, `description`, and `selected`. A label is plain text an application or a source may build from data, so draw it through `escapeControlCharacters` from `@loomcli/core`, as the default views do.
  2. Handle `highlighted` of `undefined`, which a search with no choice to highlight draws.
  3. Handle the `multiselect` member, which an override that switches on `kind` meets as a new case.
  4. In hand-built frame data, build rows: `choices: [{ kind: 'choice', label: 'sqlite', description: undefined, disabled: false, reason: undefined, selected: false }]`.
  5. Where an action compares a linked `select`'s answer with a choice string, compare it with the input's validated value, or give the input a validator whose output is the choice strings, such as `oneOf(['sqlite', 'postgres'])`.
  6. Align each linked `select`'s choices with its input's validator: remove a choice the validator rejects, such as `mysql` beside `oneOf(['sqlite', 'postgres'])`, or widen the validator to accept it.
  7. Where code reads `choices` from a `SelectSettings` value, check that it is present first, such as `settings.choices?.length ?? 0`, because a question with a `source` has none.
  8. In a unit test that calls an action asking a linked `select` through `actionContext`, state `graph: application.inspect()` and `command` as that graph's node for the routed Command, because the chosen value now passes the input's validator, which core reads from that graph's build.

  **Validation.** Run `tsc --noEmit` to type-check every hand-built frame, reader of `SelectSettings.choices`, and comparison with a linked `select`'s answer. `tsc` does not catch an override like the one before: a row object interpolated into a template string compiles and draws `[object Object]`. So run the application's test command, such as `vitest run` or `bun test`, with a test that draws each overridden `select` and `multiselect` frame through `viewContext` and asserts the text it draws, and that answers each linked `select` on `mockProcess` by choosing each of its choices.
  ````

- ADR-0082's clauses that the library exports four kinds, that text, secret, and select link a string option that is not multiple, that select returns the chosen string and a linked question returns the union of its two paths' types, and its four-kind description of select's keys, starting choice, and key help are narrowed by this record. ADR-0136 left the link of a kind that answers several values to that kind's record, and this record decides it, and it replaces the link rule's explanation ADR-0136 stated. ADR-0082 and ADR-0136 carry dated entries.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-04: Proposed with the contract for choice objects, multiselect, and search (LM-461). It narrows ADR-0082's exports, link, validation, and four-kind clauses, and decides the several-value link ADR-0136 left open. ADR-0082 and ADR-0136 carry dated entries.
- 2026-11-04: [ADR-0139](0139-an-editor-question-opens-the-operators-editor-on-a-private-temporary-file-and-core-lends-it-the-terminal.md), proposed, adds a sixth kind, `editor`, beside this record's fifth, and a fourth object variant, `EditorFrame`, to `questionFrame`'s data, beside the typed frame and the select and multiselect list frames, which keeps one view as this record has it. It binds when that record is accepted.
