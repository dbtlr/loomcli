- Remove `loom check`, under [ADR-0099](docs/decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md). The `loom` bin's commands are `build`, `changelog check`, `changelog write`, and `init`. An application checks its types with `tsc --noEmit`, its source with a linter, and its assembly with a test that passes the Application to `assertAssembles` from `@loomcli/testing`.
- Change `loom init` to write the assembly test, the lint configuration, and a `check` script that runs `tsc --noEmit`, the linter, and the test runner. A new scaffold gets `src/application.test.ts`, `.oxlintrc.json` or `eslint.config.js`, and `@loomcli/testing`, `@loomcli/eslint-plugin`, and the linter and test runner packages as development dependencies. `--linter oxlint|eslint` and `--test-runner bun|vitest` choose the tools, by default oxlint and Bun, and `--only` accepts `test` and `lint`. An existing lint configuration or a `vitest` dependency selects its tool, and at a terminal init asks when nothing does. Init still never overwrites an existing file or key. See the [toolchain reference](docs/toolchain.md#loom-init).

### Migration

**Affected surface.** Applications whose scripts, CI, or tooling run `loom check`, which now fails as an unknown command.

**Why.** Each job of `loom check` already belongs to a standard tool: `tsc` checks types, a linter guides the source, and a test runner verifies that the application assembles, in watch mode while the author works and in CI. The assembly check now runs as a test, so the author's own test runner runs it.

**Before and after.**

Before, in `package.json`:

```json
{ "scripts": { "check": "loom check" } }
```

After, with oxlint and `bun test`:

```json
{ "scripts": { "check": "tsc --noEmit && oxlint src && bun test" } }
```

Before, nothing tested the assembly. After, add `src/application.test.ts`, which imports the application module:

```ts
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';

import { application } from './application.js';

test('the application assembles', () => {
  assertAssembles(application);
});
```

Under vitest, import `test` from `vitest` instead of `bun:test`, and run `vitest run`.

**Steps.**

1. Add `@loomcli/testing` as a development dependency at the same exact version as `@loomcli/core`, and the test runner's and linter's packages when the application uses none.
2. Add the test above to the application, importing the Application the entry runs.
3. Replace each `loom check` call in scripts and CI with `tsc --noEmit`, the linter, and the test runner, or with `pnpm run check` when the script holds them.
4. To lint with Loom's rules, run `loom init --only lint`, which writes `.oxlintrc.json` or `eslint.config.js` from `@loomcli/eslint-plugin` and leaves every existing file alone.
5. Remove the `--application` option from any `loom check` call. The test imports the module itself.

**Validation.** Run `tsc --noEmit`, the linter, and the test runner, or the `check` script that holds them. The assembly test fails with the Developer Diagnostic of each fault `Application.check()` returns, and passes when the application assembles. Run `loom --help` to see the remaining commands.
