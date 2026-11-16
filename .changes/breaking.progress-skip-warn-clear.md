- Add `skip(message?)`, `warn(message?)`, and `clear()` to the progress line of `@loomcli/prompts`, so work that had nothing to do, finished with a problem, or leaves nothing worth keeping ends as such. At a terminal that redraws, `skip` leaves a dim line under the info glyph, `warn` leaves a line under the warning glyph, and `clear` removes the line and leaves no blank row. Where the line is not live, `skip` writes its end line through `out.info`, `warn` through `out.warn`, and `clear` writes nothing after the start line. A line that fails or is cancelled keeps its text, and `track()` is unchanged. The [prompts reference](docs/libs/prompts.md#progress) states each end.
- Add `'skipped'` and `'warned'` to the states `Region.end` takes and to `ProgressEvent`'s `state`, so an `onProgress` observer, `invoke`, and an MCP client, whose progress message reads `(skipped)` or `(warned)`, tell those ends from a success. A cleared line reports `ended`. The progress view's `ProgressLine` state gains the same two values. [Progress events](docs/core/output.md#progress-events) states the end states.
- Change `ProgressContext` so its `out` also carries `warn`.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is a context built by hand, such as a test's object literal, that omits `out.warn` and is passed to `progress()` from `@loomcli/prompts`. A context core hands an action, a middleware, or a configuration source, and one `@loomcli/testing` builds, already carries `warn`.

**Why.** A warned line that is not live writes its end line through `out.warn`, so `progress()` needs the warn lane.

**Before and after.**

Before:

```ts
const line = progress({ graph, out: { error, info, region, success } }, { label: 'Fetching records' });
```

After:

```ts
const line = progress({ graph, out: { error, info, region, success, warn } }, { label: 'Fetching records' });
```

**Steps.**

1. Add a `warn` method to each hand-built context passed to `progress()`, with the signature `Out['warn']` gives it, or build the context with `actionContext` from `@loomcli/testing`.

Note, not a break: `'skipped'` and `'warned'` are new values of a progress event's and a progress line's `state`, as a string-literal union core produces may gain a member in any release. Where an `onProgress` observer or an override of the `@loomcli/prompts/progress` view switches over `state` with no default branch, handle the two new values.

**Validation.** Run the application's type check, such as `pnpm exec tsc --noEmit`, and its tests.
