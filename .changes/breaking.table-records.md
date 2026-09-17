- Add `@loomcli/plugins/table`. `table<Row>(config?)` returns a whole view over the collected rows, `View<readonly Row[]>`, and installs nothing: the subpath exports the factory alone, with no plugin, no option, and no graph fact. Its `columns` list orders the columns and names each one's key, header, alignment, and optional `format`, and an omitted list makes every key that appears in the rows a column in first-seen order. The view prints a `dim` header line and one padded line per row, separated by a two-space gutter, never truncates a cell, and measures every column with the context's `width`. The [core reference](docs/core.md#table) states the form, the cells, the empty cases, and the typing.
- Add `@loomcli/plugins/records`. `records<Row>(config)` returns a row view, `RowView<Row>`, so each record prints as its source yields it. `identifier` is required and names the key whose value the view styles `highlight`; the optional `fields` list orders the fields and names each one's key and optional `format`, and a field carries no header and no alignment. Each record prints one line per field, the `dim` key padded against the widest key and then the value, records are separated by one blank line, and `tail` prints the `dim` summary line `N records`, singular at one and `0 records` for an empty sequence. The [core reference](docs/core.md#records) states the rest.
- Change `RowView.tail` to receive the rendered row count before the view context, `tail?: (count: number, context: ViewContext) => string`. Core passes the number of rows `row` was called with, zero on an empty sequence, so a closing summary reports a count no view has to accumulate. `head` and `row` are unchanged. The [core reference](docs/core.md#row-views) states the signature.

### Migration

**Affected surface.** Any `RowView` whose `tail` reads the view context as its first parameter, whether it is passed to `out.render`, named in a result's `views` record, declared with `view(identity, definition)`, or supplied as an `override()` replacement keyed by a `DeclaredRowView`. A `tail` that takes no parameter at all is unaffected. TypeScript reports each affected site, because the first parameter's type changes from `ViewContext` to `number`.

**Why.** A row view sees one row at a time and cannot count the sequence it is closing. Every closing summary therefore had to accumulate a count outside the view, which made the view impure and defeated reuse. Core already knows the count when it calls `tail`, so it passes it.

**Before and after.**

Before, a row view whose `tail` reads the context:

```ts
const list: RowView<Entry> = {
  row: ({ path }, index, { style }) => `${style.escape(path)}\n`,
  tail: ({ style }) => style.dim('end of list') + '\n',
};
```

After, the count arrives first and the context second:

```ts
const list: RowView<Entry> = {
  row: ({ path }, index, { style }) => `${style.escape(path)}\n`,
  tail: (count, { style }) => style.dim(`${count} entries`) + '\n',
};
```

**Steps.**

1. Find every `RowView` in the application and its libraries, including `view()` declarations and `override()` replacements keyed by a `DeclaredRowView`, and list those that implement `tail`.
2. For each one, insert the count as `tail`'s first parameter and move the view context to the second. Where the view accumulated a count in a closure or a module variable to print a summary, delete that state and read `count`.
3. Where a records list is what the hand-written row view produced, replace it with `records({ identifier })` from `@loomcli/plugins/records` and delete the view, and replace a hand-written aligned table with `table({ columns })` from `@loomcli/plugins/table`.
4. Recheck the project's types, since the changed parameter type is a compile error at every affected site rather than a silent behavior change.

**Validation.** Run `pnpm exec vp check` to confirm no `tail` implementation still types its first parameter as the view context. Run the application's tests under both runtimes, `pnpm exec vp test --run` and `LOOM_TEST_RUNTIME=bun pnpm exec vp test --run`, and compare the bytes of one invocation that renders a row view with a `tail` against the bytes it produced before the upgrade.
