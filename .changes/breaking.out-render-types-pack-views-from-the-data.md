- Change `out.render` to type a records view written as its second argument from the rows it renders, as a table, a list, and `json()` already were. A `format` callback under `records({…})` received `any` for its value, so a callback that misread its field compiled; it now receives the field's own type over an array, a generator, or an async generator, and a key the rows do not carry is reported on that key. `Out.render` is one signature over both view shapes, `render<Data>(data: Data, view: RenderedView<Data>)`, with `RenderedView` and `SequenceView` exported from `@loomcli/core`.

### Migration

**Affected surface.** An action or middleware that calls `out.render(rows, records({…}))` with a `format` callback whose parameter type, or whose use of its value, does not match the field's type in the rows. Calls that already typed their callbacks correctly, and calls that state `records<Row>({…})`, are unaffected. Also affected: inline literal rows passed to a row view whose row type is a literal union, such as `out.render([{ variant: 'compact' }], variants)` under a `RowView<{ variant: 'compact' | 'extended' }>`, because the rows' type now comes from the data alone and the literal widens to `string`.

**Why.** The callback's value was `any`, so the mismatch was a latent bug the compiler could not see. The compiler now checks it, which takes one signature for both view shapes with the type read from the data.

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
3. For each error on inline rows under a row view, state the rows' type on the array, `const rows: readonly Variant[] = [{ variant: 'compact' }]`, and pass `rows`.

**Validation.** Run the application's type check until it reports no error, then run its tests to confirm each records view prints as before.
