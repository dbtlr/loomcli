- Narrow `CommandGraph.version` from `string | undefined` to `string`. An omitted Application version is `0.0.0`, which means unversioned, so the graph always carries one.
- Reject a declared version that is blank, holds only whitespace, or holds a line terminator. Build applies the rule in `inspect()` and in `run()`.
- Change the diagnostic for a version that is not a string to the one sentence every version fault now reports: `The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".`

### Migration

**Affected surface.** Every projection that reads `CommandGraph.version`, and every Application whose declared `version` is blank, whitespace-only, or holds a line terminator.

**Why.** `version` is never absent: `0.0.0` is the documented value for an unversioned Application in [Graph inspection](docs/core.md#graph-inspection), so a projection reads that value instead of branching on `undefined`. A version that carries no visible text or spans several lines cannot appear in one line of output, the same rule every other core fact string already follows.

**Before and after.**

Before:

```ts
const graph = app.inspect();
const label = graph.version === undefined ? 'unversioned' : graph.version;
```

After:

```ts
const graph = app.inspect();
const label = graph.version === '0.0.0' ? 'unversioned' : graph.version;
```

**Steps.**

1. Replace a check of `graph.version === undefined` with a check of `graph.version === '0.0.0'`.
2. Replace a declared version that is blank, whitespace-only, or holds a line terminator with a one-line version, or omit `version` to declare none.

**Validation.** Run the application's type check to find any remaining branch on `graph.version === undefined`, which no longer compiles because `version` is a `string`. Run one invocation of an Application whose declared version breaks the rule, such as `node ./your-cli.js`: it reports `Invalid declaration: The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".` and exits with code 1.
