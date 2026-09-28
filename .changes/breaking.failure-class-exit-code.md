- Change `LoomError`'s constructor to `constructor(message: string)`. A failure class declares its exit code once, as `static override readonly exitCode`, and core reads it from the nearest ancestor that declares one; `failure.exitCode` reports the same value. `LoomError` declares 1 and `UsageError` declares 2, so every core class keeps its code. See [Declared exit codes](docs/core.md#declared-exit-codes) and [ADR-0045](docs/decisions/0045-a-failure-class-declares-its-exit-code.md).
- Change `ExitCode` to widen from `0 | 1 | 2 | 130 | 143` to `0 | FailureExitCode | 130 | 143`, where the exported `FailureExitCode` is every whole number from 1 through 125.

### Migration

**Affected surface.** A class that extends `LoomError` directly and passes a code to `super(message, code)`. Every consumer that switches exhaustively on the published `ExitCode` type, including a `switch` with no `default` case or a type-level exhaustiveness check.

**Why.** A code passed to the constructor exists only on an instance and lets one class exit with two codes. A static declaration states the code once, so a script branches on the code the way a view branches on the class, and a projection reads the code without constructing a failure. An application's own failure class may now exit with a code from 3 through 125, so `run()` can resolve any of them.

**Before and after.**

Before:

```ts
import { LoomError } from '@loomcli/core';
import type { ExitCode } from '@loomcli/core';

class QuotaError extends LoomError {
  constructor(message: string) {
    super(message, 1);
    this.name = 'QuotaError';
  }
}

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

After:

```ts
import { LoomError } from '@loomcli/core';
import type { ExitCode } from '@loomcli/core';

class QuotaError extends LoomError {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaError';
  }
}

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
    default:
      return `failed with declared code ${String(code)}`;
  }
}
```

**Steps.**

1. Remove the second argument from each `super(message, code)` call in a class that extends `LoomError`.
2. Where that argument was not 1, declare the code on the class: `static override readonly exitCode = 2;`, or a constant such as `EX_DATAERR` from `@loomcli/core`.
3. Add a case or a `default` branch for codes 3 through 125 to every exhaustive `switch` or lookup over `ExitCode`.

**Validation.** Run the application's type check. A remaining second argument to `super` reports `Expected 1 arguments, but got 2.`, and an unhandled `ExitCode` member reports in the exhaustiveness check. Run a Command that raises each migrated class and confirm the process exits with the code it exited with before.
