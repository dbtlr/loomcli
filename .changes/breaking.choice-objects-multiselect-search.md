- Add `multiselect`, a question that offers the same choices as `select`, toggles them with Tab always and with Space when it does not search, submits them in the order they were selected between `min` and `max`, and links a multiple string option or a variadic string argument.
- Add choice objects to `select` and `multiselect`: a `value` of any type on an unlinked question, a `label`, a `description`, and a `disabled` state with its reason, beside `{ separator }` entries.
- Add `search: true`, which filters a question's static choices as the operator types, and `source`, a function that returns the choices for a search term and whose previous call each keystroke aborts.
- Add Ctrl-P, Ctrl-N, Home, and End to a select's navigation, and draw a supplied value a question cannot select in its issue instead of dropping it.
- Add `validateLinkedValue` to `@loomcli/core`, which runs a linked input's validator on one value with the question's validation options.
- Change a linked `select` that asks to pass the chosen value through the linked input's validator and return its output, typed as the input's value, as a skipped `select` already returns. A choice the validator rejects now keeps the question asking with the validator's issue, where it used to return the choice's string, and a test that asks one through `actionContext` states a `graph` that `inspect()` returned.
- Change `SelectSettings` to a union of a `choices` list and a `source`, so its `choices` is optional.
- Change the `select` member of `questionFrame`'s data to choice rows and separator rows, which the new `multiselect` member shares, with a `highlighted` that may be `undefined`, and export `TypedFrame`, `ListFrame`, `ChoiceRow`, and `SeparatorRow` from `@loomcli/prompts/views`.

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

**Validation.** Run `tsc --noEmit` to type-check every `questionFrame` override, hand-built frame, reader of `SelectSettings.choices`, and comparison with a linked `select`'s answer. Then run the application's test command, such as `vitest run` or `bun test`, with a test that draws each overridden frame through `viewContext` and answers each linked `select` on `mockProcess` by choosing each of its choices.
