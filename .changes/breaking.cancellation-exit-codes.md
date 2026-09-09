- Add `run({ signal })`. It accepts a caller-owned `AbortSignal` that cancels the run; core subscribes at run entry and honors the abort at every phase boundary. A value that is not an `AbortSignal` is an internal error with code 1.
- Add the signals slot. One installed plugin claims `SIGINT`, `SIGTERM`, or both, each of them once; core installs one process listener per claimed signal once the graph has validated, removes them on every exit path of that run, and re-raises a repeated signal so the default disposition ends the process when no other listener remains.
- Add a typed cancellation reason. The `signal` on a middleware context and on an action context aborts with a reason core owns, the exported `CancellationReason`, `{ source: 'SIGINT' | 'SIGTERM' | 'caller', cause?: unknown }`, where `cause` carries the caller's own `signal.reason`, so a middleware reads `source` and never infers a signal name.
- Change `ExitCode` to widen from `0 | 1 | 2` to `0 | 1 | 2 | 130 | 143`: 130 for `SIGINT` or a caller abort, 143 for `SIGTERM`.

### Migration

**Affected surface.** Every consumer that switches exhaustively on the published `ExitCode` type, including a `switch` with no `default` case or a type-level exhaustiveness check.

**Why.** A cancelled run now resolves a code of its own, 130 or 143, instead of falling into an existing code. A consumer that matched every member of `ExitCode` before this change now has a `switch` that no longer type-checks, because two members are unhandled.

**Before and after.**

Before:

```ts
import type { ExitCode } from '@loomcli/core';

function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'succeeded';
    case 1:
      return 'failed';
    case 2:
      return 'invalid input';
  }
}
```

After:

```ts
import type { ExitCode } from '@loomcli/core';

function describe(code: ExitCode): string {
  switch (code) {
    case 0:
      return 'succeeded';
    case 1:
      return 'failed';
    case 2:
      return 'invalid input';
    case 130:
      return 'cancelled by SIGINT or a caller abort';
    case 143:
      return 'cancelled by SIGTERM';
  }
}
```

**Steps.**

1. Find every exhaustive `switch` or lookup over `ExitCode` with the type checker; a missing case reports the unhandled literals.
2. Add a `130` case for `SIGINT` or a caller-supplied abort, and a `143` case for `SIGTERM`.
3. Where the consumer treats an unknown code as success, confirm that treatment still holds for 130 and 143, since a script that reports 0 after an interrupt carries on as if the work finished.
4. If the consumer owns a supervising process, decide whether to propagate 130 or 143 to its own exit code or to translate them, and update its own documented exit codes accordingly.

**Validation.** Run `pnpm exec tsc --noEmit`, or the consumer's own type check, to confirm every `ExitCode` switch compiles with the two new cases. A code of 130 or 143 reaches a consumer only when the application installs a plugin that owns the signals slot, or when the caller supplies `run({ signal })`; with neither, core installs no listener and a process signal keeps its default effect. With an owner installed, interrupt a long-running invocation with Ctrl-C and confirm the process exits 130, then send `SIGTERM` to another and confirm it exits 143.

See the [core reference](docs/core.md) for the exit code table and the [signals and cancellation](docs/core.md#signals-and-cancellation) section, and [ADR-0018](docs/decisions/0018-one-run-signal-carries-cancellation-and-one-owner-brackets-process-signals.md) for the decision.
