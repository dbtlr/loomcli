- Add `skip(message?)`, `warn(message?)`, and `clear()` to the progress line of `@loomcli/prompts`, so work that had nothing to do, finished with a problem, or leaves nothing worth keeping ends as such. At a terminal that redraws, `skip` leaves a dim line under the info glyph, `warn` leaves a line under the warning glyph, and `clear` removes the line and leaves no blank row. Where the line is not live, `skip` writes its end line through `out.info`, `warn` through `out.warn`, and `clear` writes nothing after the start line. A line that fails or is cancelled keeps its text, and `track()` is unchanged. The [prompts reference](docs/libs/prompts.md#progress) states each end.
- Add `'skipped'` and `'warned'` to the states `Region.end` takes and to `ProgressEvent`'s `state`, so an `onProgress` observer, `invoke`, and an MCP client, whose progress message reads `(skipped)` or `(warned)`, tell those ends from a success. A cleared line reports `ended`. The progress view's `ProgressLine` state gains the same two values. [Progress events](docs/core/output.md#progress-events) states the end states.
- Change `ProgressContext` so its `out` also carries `warn`.

### Migration

**Affected surface.** The type checker reports every affected site, for each of two breaks.

- A context built by hand, such as a test's object literal, that omits `out.warn` and is passed to `progress()` from `@loomcli/prompts`. A context core hands an action, a middleware, or a configuration source, and one `@loomcli/testing` builds, already carries `warn`.
- A switch over a progress line's or a progress event's `state` that has no default branch and relies on covering every state, such as an override of the `@loomcli/prompts/progress` view whose `render` returns a string from one case per `ProgressLine` state, or an `onProgress` observer that ends its switch over `ProgressEvent['state']` with an exhaustiveness check. Under `strict` it no longer compiles, with an error such as TS2366, "Function lacks ending return statement", or a `never` check that rejects `'skipped'`.

**Why.** A warned line that is not live writes its end line through `out.warn`, so `progress()` needs the warn lane. A skipped and a warned end are new states of the line and of its progress events, so a reader tells them from a success.

**Before and after.**

Before:

```ts
const line = progress({ graph, out: { error, info, region, success } }, { label: 'Fetching records' });
```

After:

```ts
const line = progress({ graph, out: { error, info, region, success, warn } }, { label: 'Fetching records' });
```

Before, in an override of the progress view:

```ts
function render(line: ProgressLine): string {
  switch (line.state) {
    case 'running': return `… ${line.label}`;
    case 'ended': return `done ${line.label}`;
    case 'failed': return `failed ${line.label}`;
    case 'cancelled': return `stopped ${line.label}`;
  }
}
```

After:

```ts
function render(line: ProgressLine): string {
  switch (line.state) {
    case 'running': return `… ${line.label}`;
    case 'ended': return `done ${line.label}`;
    case 'failed': return `failed ${line.label}`;
    case 'cancelled': return `stopped ${line.label}`;
    case 'skipped': return `skipped ${line.label}`;
    case 'warned': return `warning ${line.label}`;
  }
}
```

**Steps.**

1. Add a `warn` method to each hand-built context passed to `progress()`, with the signature `Out['warn']` gives it, or build the context with `actionContext` from `@loomcli/testing`.
2. Where an `onProgress` observer, an override of the `@loomcli/prompts/progress` view, or other code switches over a progress event's or a progress line's `state`, handle `'skipped'` and `'warned'`: the type checker reports a switch with no default branch that must cover every state, and code that treats an unknown value as an error at run time needs the same two cases.

**Validation.** Run the application's type check, such as `pnpm exec tsc --noEmit`, and its tests.
