- Remove `loom check`, under [ADR-0099](docs/decisions/0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md). The `loom` bin's commands are `build`, `changelog check`, `changelog write`, and `init`. An application checks its types with `tsc --noEmit`, its source with a linter, and its assembly with a test that passes the Application to `assertAssembles` from `@loomcli/testing`.

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
/// <reference types="bun" />
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';

import { application } from './application.js';

test('the application assembles', () => {
  assertAssembles(application);
});
```

Under vitest, import `test` from `vitest` instead of `bun:test`, and run `vitest run`.

**Steps.**

1. Add the development dependencies. `@loomcli/testing` takes the same exact version as `@loomcli/core`. The test runner is Bun's own `bun test` with `@types/bun`, or `vitest`. To lint with Loom's rules, add `@loomcli/eslint-plugin` at the same exact version, and the linter: `oxlint`, or `eslint` with `typescript-eslint`. For example, with pnpm, oxlint, and `bun test`: `pnpm add --save-dev --save-exact @loomcli/testing@<version> @loomcli/eslint-plugin@<version> oxlint @types/bun`.
2. Add the test above to the application as `src/application.test.ts`, importing the Application the entry runs.
3. Replace each `loom check` call in scripts and CI with `tsc --noEmit`, the linter, and the test runner, or with `pnpm run check` when the script holds them.
4. Load the lint rules. In a package with no lint configuration, run `loom init --only lint`, which writes `.oxlintrc.json` or `eslint.config.js` from `@loomcli/eslint-plugin`. A package that already holds a lint configuration gets nothing from `loom init --only lint`, because init never overwrites a file, so add the plugin to that configuration as the [plugin reference](docs/libs/eslint-plugin.md#install-and-configure) shows.
5. Remove the `--application` option from any `loom check` call. The test imports the module itself.

An ESLint package on TypeScript 7 also needs the side-by-side install of the [plugin reference](docs/libs/eslint-plugin.md#eslint), because typescript-eslint does not support TypeScript 7: `typescript` aliased to `npm:@typescript/typescript6@^6.0.2` and the compiler installed as `@typescript/native`, so `tsc` stays on TypeScript 7.

**Validation.** Run `pnpm run check`, or `tsc --noEmit`, the linter, and the test runner it holds one after another, and confirm that each exits 0 and that the test runner reports the assembly test as passed. Run `grep -rn "loom check" package.json .github` and confirm that it prints nothing. Run `pnpm loom --help` and confirm that it lists `build`, `changelog`, and `init` and no `check`.
