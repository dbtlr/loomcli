- Add `result<Value>({ views })` and `rows<Row>({ views })`, the authoring calls a Command and an Application's root declare what they produce with. The type is stated by the author, `views` is a record keyed by presentation name whose first key is the default, and `action()` closes both calls, so an extracted `ActionHandler` types the emission from the declaration it imports.
- Add `views(replacements, { default })`, published in every state on a declaration that carries a result. It merges by key, so a name the record already holds keeps its position and a new name is appended, and a default once named persists through later calls that name none, so an importing application reshapes presentation without touching the action.
- Add `out.results(value)`, the one call an action emits its result through. Under `result<Value>` it renders the resolved view over the value; under `rows<Row>` it accepts any iterable or async iterable and either feeds a row view as the source yields or collects the sequence for a whole view.
- Add `RowView<Row>`, a view that renders a sequence one row at a time through `row`, with optional `head` and `tail`. `view(identity, definition)` and `override(key, replacement)` accept the shape, and `out.render(rows, rowView)` takes an iterable or an async iterable, requesting the next row only after the previous piece is written.
- Change stdout to belong to the result. On a Command that declares one, the action's `print` and `render` write to stderr with stderr's capabilities, decided at graph build, so a script that captures stdout reads the result alone. A middleware's channel keeps the default destinations, and no method is removed.
- Add `ResultError`, an `InternalError` carrying the routed `path`, a `kind` of `missing`, `repeated`, `undeclared`, or `middleware`, and no cause. An action that returns without emitting fails with exit 1, a second emission turns a would-be 0 into 1, and a cancelled run raises no missing-result fault.
- Add `incompleteResult`, the declared view core writes on stderr when a sequence stops early, before the fault's own report. It carries the routed path and the yielded and written counts, and an override that returns the empty string silences it.
- Add `result` to every node `inspect()` publishes: `null` where none is declared, and otherwise the unit, the presentation names in record order, and the default. The [core reference](docs/core.md#results) states the lane and its build rules.
- Change `Out` to carry a required `results` member, and `View` to carry `row?: never`, so the two view shapes are exclusive in the type system.

### Migration

**Affected surface.** Two published types. `Out<Result>` gains the required member `results`, so a value that implements `Out` by hand, such as a test double for an action's channel, no longer satisfies the type without it. `View<Data>` gains `row?: never`, so an object literal that carries both `render` and `row` no longer satisfies `View`, and `view(identity, definition)` rejects such a definition at the call with a `DeclarationError`.

**Why.** An action emits its result through one call, so `results` is on every `Out` rather than added by a declaration, and a Command with no result types its argument `never`. A view renders one whole value or one row at a time, never both, so the exclusion is stated in the type rather than guessed at the write site.

**Before and after.**

Before, a hand-built channel in a test:

```ts
import type { Out } from '@loomcli/core';

const out: Out = {
  error: async () => undefined,
  fatal: (message) => {
    throw new Error(message);
  },
  info: async () => undefined,
  print: async () => undefined,
  render: async () => undefined,
  success: async () => undefined,
  warn: async () => undefined,
};
```

After, with the emission the lane requires:

```ts
import type { Out } from '@loomcli/core';

const out: Out = {
  error: async () => undefined,
  fatal: (message) => {
    throw new Error(message);
  },
  info: async () => undefined,
  print: async () => undefined,
  render: async () => undefined,
  results: async () => undefined,
  success: async () => undefined,
  warn: async () => undefined,
};
```

Before, one object serving as both shapes:

```ts
const rowsAndValue = {
  render: (all: readonly Row[]) => all.map(line).join(''),
  row: (row: Row) => line(row),
};
```

After, one object per shape:

```ts
const whole: View<readonly Row[]> = { render: (all) => all.map(line).join('') };
const byRow: RowView<Row> = { row: (row) => line(row) };
```

**Steps.**

1. Add a `results` member to every hand-built `Out` value. A double that emits nothing returns a resolved promise.
2. Find every view value that carries `render` beside `row` and split it into one whole view and one row view. Name each where its shape is wanted: a `views` record entry, an `out.render` argument, or a `view(identity, definition)` call.
3. Rebuild, and read each new error at a `View` or `Out` annotation. Both changes surface at compile time.

**Validation.** Run `pnpm run check:types`, or `tsc --noEmit` in the application's own project, to find every value the two types now reject. Then run the application's tests under both runtimes: `pnpm exec vp test --run`, and `LOOM_TEST_RUNTIME=bun pnpm exec vp test --run`.
