- Change an unknown command to a held fault: core raises `UnknownCommandError` at the dispatch boundary after running the `'always'` middleware, which read the unknown word and the words after it under the new `unknownCommand` member of the middleware context. A middleware may take such a run over. An application with no such middleware prints and exits as before. See [Middleware](docs/core/middleware.md) and [ADR-0192](docs/decisions/0192-core-holds-an-unknown-command-for-the-chain-and-a-plugin-runs-an-external-command-from-path.md).
- Add `invokedBy` and `exitCode` to the middleware context. A takeover, a middleware that returns without calling `next()` or that catches the fault the dispatch boundary raised, may assign `exitCode` to end the run with that code and print nothing. `invoke()`'s `completed` outcome gains an optional `exitCode`, present when a takeover stated a code other than 0.
- Change `ExitCode` to every whole number from 0 through 255, because a takeover may state a child program's code. `FailureExitCode` still bounds a failure class at 1 through 125.

### Migration

**Affected surface.** The type checker reports code that narrows an `ExitCode` to `FailureExitCode` or to the codes it listed before, such as a `switch` whose `default` branch assigns the code to `FailureExitCode` or `never`. No compile error: behavior changes at run time for an `'always'` middleware, which now runs on a run that names an unknown command, where its `next()` rejects with `UnknownCommandError`, its `request` and `options` read `null`, and its `ownOptions` reads an empty record.

**Why.** An operator extends an application by putting `<application>-<word>` on `PATH`, which a middleware can serve only when it sees the unknown command and can end the run with the program's exit code.

**Before and after.**

Before, code that read every code past the cancellations as a failure class's:

```ts
function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'ok';
    case 129:
    case 130:
    case 131:
    case 141:
    case 143:
      return 'cancelled';
    default: {
      const failure: FailureExitCode = code;
      return `failed with ${String(failure)}`;
    }
  }
}
```

After, the remaining codes are any code a takeover stated:

```ts
function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'ok';
    case 129:
    case 130:
    case 131:
    case 141:
    case 143:
      return 'cancelled';
    default:
      return `exited ${String(code)}`;
  }
}
```

An `'always'` middleware now also runs on an unknown command, where its `next()` rejects. Loaded by a plugin `auditing()` that declares `middleware: { activate: 'always', load: () => import('./audit.js') }`, this audit middleware never saw `app nope` before; after, it records the run and the rejection reaches it:

```ts
const audit: Middleware<typeof auditing> = async ({ next, unknownCommand }) => {
  try {
    await next();
  } finally {
    // After: also runs for `app nope`, where `unknownCommand` is { word: 'nope', rest: [] }.
    record(unknownCommand?.word ?? 'routed');
  }
};

export default audit;
```

**Steps.**

1. Run the type checker, and give each site it reports a branch for any code from 0 through 255 that a takeover may state.
2. In an `'always'` middleware that reads `request`, `options`, or a value only a routed run has, check `unknownCommand` first, or read the `null` request as it reads one under any held fault.

**Validation.** Run the type checker with no errors. Run the application with an unknown command, such as `app nope`, and check that it prints the same unknown-command failure and exits 2. Check that each `'always'` middleware completes on that run without reading a `null` `request` or `options`.
