- Change `out.render` to type a records view written as its second argument from the rows it renders, as a table and `json()` already were and as the new list view is. A `format` callback under `records({…})` received `any` for its value, so a callback that misread its field compiled; it now receives the field's own type over an array, a generator, or an async generator, and a key the rows do not carry is reported on that key. `Out.render` is one signature over both view shapes, `render<Data, Row = never>(data: RenderedData<Data, Row>, view: View<Data> | ([Row] extends [never] ? RowViewOver<Data> : RowView<Row>))`, with `RenderedData` and `RowViewOver` exported from `@loomcli/core`.

### Migration

**Affected surface.** An action or middleware that calls `out.render(rows, records({…}))` with a `format` callback whose parameter type, or whose use of its value, does not match the field's type in the rows. Calls that already typed their callbacks correctly, and calls that state `records<Row>({…})`, are unaffected. Also affected: a call whose data carries no row type, where an unstated `records({…})` or another pack view factory, or a row view written in the call, no longer reads one: data typed `any`, such as the result of `JSON.parse`; data whose type is a helper's type parameter, `<Source extends readonly Row[]>`; and inline literal rows under a row view whose row type is a literal union, such as `out.render([{ variant: 'compact' }], variants)` under a `RowView<{ variant: 'compact' | 'extended' }>`, where the literal widens to `string`. Also affected: a call that passes the row type as `out.render`'s type argument, `out.render<Row>(rows, view)`, which matched the earlier overload over rows; the type argument now names the data.

**Why.** The callback's value was `any`, so the mismatch was a latent bug the compiler could not see. The compiler now checks it, which takes one signature for both view shapes.

**Before and after.**

Before, with `count: number` on each row, this compiled:

```ts
await out.render(rows, records({ identifier: 'source', fields: [{ key: 'count', format: (value: string) => value.padStart(6) }] }));
```

After, the callback takes the field's type:

```ts
await out.render(rows, records({ identifier: 'source', fields: [{ key: 'count', format: (value) => String(value).padStart(6) }] }));
```

**Steps.**

1. Run the application's type check.
2. For each error under a `records({…})` call, correct the callback's parameter type or its use of the value to match the field's type.
3. For each error where the data carries no row type, state it: a factory's type argument, `records<Row>({…})`, a typed row view, `const view: RowView<Row> = { row: … }`, or, for inline literal rows, the array's type, `const rows: readonly Variant[] = [{ variant: 'compact' }]`.
4. For each call written `out.render<Row>(rows, view)`, drop the type argument, or name the data, `out.render<readonly Row[]>(rows, view)`.

**Validation.** Run the application's type check until it reports no error, then run its tests to confirm each records view prints as before.
