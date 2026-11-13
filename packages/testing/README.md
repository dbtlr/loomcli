# @loomcli/testing

Test helpers for a Loom application, for `bun test` and vitest alike:

- `assertAssembles`, the assembly check, fails a test for a fault that only the assembled application reveals, which an operator would otherwise meet on the first run.
- `mockProcess` is a process handle a test runs the application on, then reads the run's output and exit code from. Its keyboard answers questions from scripted keys.
- The context builders, such as `actionContext` and `viewContext`, build the context one author function reads, so a test calls that function with no application.

`@loomcli/core` is a peer dependency, at the same version as the application's.

## Install

```sh
pnpm add -D @loomcli/testing
```

## Use

```ts
import { assertAssembles } from '@loomcli/testing';
import { test } from 'vitest';

import { application } from './application.js';

test('the application assembles', () => {
  assertAssembles(application);
});
```

## Documentation

The [testing reference](https://github.com/dbtlr/loomcli/blob/main/docs/libs/testing.md) documents every helper, and the [documentation map](https://github.com/dbtlr/loomcli/blob/main/docs/README.md) covers the rest of Loom.
