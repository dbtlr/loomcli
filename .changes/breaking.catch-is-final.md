- Change a failure that author or plugin code catches to be final, under [ADR-0097](docs/decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The run's outcome is what the outermost middleware settles with, or the action when no middleware wraps it:
  - A middleware that catches the action's failure, or the held fault the dispatch boundary raises, and returns now exits 0 in place of the caught failure's code.
  - An action or a middleware that awaits an `out.render`, `out.draw`, lane, or region call and catches its view's rejection now exits 0.
  - An action that catches the rejection of a second `out.results` call now exits 0. A second call no code awaits still fails the run with exit 1.
  - A second `next()` call, or one after the middleware returned, still rejects and dispatches nothing. A middleware that catches the rejection decides the outcome, and core no longer reports it after the outcome. A misuse call no code awaits or attaches to still fails the run with its `@loomcli/core/next-misuse` defect.
  - A throw while a middleware unwinds, after its `next()` settled, is that middleware's failure, with its own class and exit code, and a translator is offered it, in place of an internal error reported after the earlier outcome.
  - A view failure or a row source failure in a call no code awaited still fails the run after the chain settles, now with the failure's own exit code. A thrown failure class keeps its code in place of 1, and a view's throw reports as `@loomcli/core/foreign-throw`. A middleware that never observes its `next()` takes the rejection as its own outcome.
  - A cancelled run still resolves 130, 141, or 143 when code catches the cancellation.

### Migration

**Affected surface.** A middleware or an action that catches a failure, a view's rejection, or a second `out.results` rejection on purpose and relies on the caught failure still deciding the exit code. A middleware that throws while unwinding and relies on the earlier failure's code.

**Why.** A caught failure is the code's to decide, as JavaScript defines `try`, `catch`, and `finally`, so a deliberate retry, fallback, or recovery is no longer overridden by core.

**Before and after.**

Before, the run exited 1 because core recorded the caught failure:

```ts
const middleware: Middleware = async ({ next, out }) => {
  try {
    await next();
  } catch (error) {
    await out.warn(`The command failed: ${String(error)}`);
  }
};
```

After, the middleware rethrows the failure so the run still exits with its code:

```ts
const middleware: Middleware = async ({ next, out }) => {
  try {
    await next();
  } catch (error) {
    await out.warn(`The command failed: ${String(error)}`);
    throw error;
  }
};
```

**Steps.**

1. Find each `catch` around `next()`, `out.render`, `out.draw`, a lane call such as `out.info`, a region's `draw`, or `out.results` in a middleware or an action.
2. Where the caught failure must still decide the exit code, rethrow it, or throw a failure class with the code you want.
3. Where a middleware throws in a `finally` or after `await next()`, expect that throw's class and exit code to be the run's outcome.

**Validation.** Run the application's tests, and run the affected commands with a failing action or view to check that each exits with the code you expect.
