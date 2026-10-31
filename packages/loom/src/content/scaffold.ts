import loomPlugin from '@loomcli/eslint-plugin';

import type { TestRunner } from '../helpers/tooling.js';

/** Text as a single-quoted TypeScript string literal. */
function quoted(text: string) {
  return `'${text.replaceAll('\\', String.raw`\\`).replaceAll("'", String.raw`\'`)}'`;
}

/**
 * The application module a new scaffold writes to `paths.application`, `src/application.ts` by
 * convention: an Application with a description and one action, so the scaffold assembles and runs.
 */
export function applicationModule(name: string, identifier: string): string {
  return `import { Application } from '@loomcli/core';

export const ${identifier} = new Application(${quoted(name)}, {
  description: ${quoted(`Describe what ${name} does.`)},
}).action(({ out }) => out.print(${quoted(`${name} is ready. Replace this action with your own.`)}));
`;
}

/**
 * How the entry imports the Application: by the name the application module exports it under, or
 * as the module's default export, bound to an identifier of the entry's own.
 */
export interface ApplicationImport {
  readonly identifier: string;
  readonly kind: 'default' | 'named';
}

/**
 * The entry a scaffold writes to `paths.entry`, `src/main.ts` by convention, which runs the
 * Application of the module at `specifier`, the application module's path relative to the entry.
 */
export function entryModule({ identifier, kind }: ApplicationImport, specifier: string): string {
  const binding = kind === 'named' ? `{ ${identifier} }` : identifier;
  return `#!/usr/bin/env node
import ${binding} from ${quoted(specifier)};

await ${identifier}.run();
`;
}

/**
 * The test a scaffold writes to `<source>/application.test.ts`: it imports the Application from
 * `specifier`, the application module's path relative to the test, and passes it to the assembly
 * check of `@loomcli/testing`, under the test runner. The comment says why to keep it.
 * A Bun test names its types with a reference directive, because TypeScript loads no `@types`
 * package unless a configuration lists it, and a package's own `tsconfig.json` may not.
 */
export function applicationTest(
  runner: TestRunner,
  { identifier, kind }: ApplicationImport,
  specifier: string,
): string {
  const binding = kind === 'named' ? `{ ${identifier} }` : identifier;
  const imports =
    runner === 'bun'
      ? `/// <reference types="bun" />
import { test } from 'bun:test';
import { assertAssembles } from '@loomcli/testing';`
      : `import { assertAssembles } from '@loomcli/testing';
import { test } from 'vitest';`;
  return `${imports}

import ${binding} from ${quoted(specifier)};

// Keep this test. It is the check that the whole application assembles, so a fault only the
// assembled application reveals fails CI rather than the operator's first run.
test('the application assembles', () => {
  assertAssembles(${identifier});
});
`;
}

/** The `.oxlintrc.json` a scaffold writes: the configuration `@loomcli/eslint-plugin` ships. */
export const oxlintConfig = `${JSON.stringify(loomPlugin.configs.oxlint, undefined, 2)}\n`;

/**
 * The `eslint.config.js` a scaffold writes: the plugin's recommended configuration for the
 * TypeScript source under `source`, the source folder relative to the package directory, with the
 * TypeScript parser ESLint needs to read it.
 */
export function eslintConfig(source: string): string {
  const files = quoted(source === '.' ? '**/*.ts' : `${source}/**/*.ts`);
  return `import loom from '@loomcli/eslint-plugin';
import tseslint from 'typescript-eslint';

export default [
  { files: [${files}], languageOptions: { parser: tseslint.parser } },
  { files: [${files}], ...loom.configs.recommended },
];
`;
}

/**
 * The `tsconfig.json` a scaffold writes: a strict configuration for a Node ESM application that
 * `loom build` bundles, so the compiler only type-checks, which the `check` script runs. It
 * includes `source`, the source folder relative to the package directory.
 */
export function typescriptConfig(source: string): string {
  return `${JSON.stringify(
    {
      compilerOptions: {
        module: 'NodeNext',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'ES2022',
      },
      include: [source],
    },
    undefined,
    2,
  )}\n`;
}

/** The `package.json` init writes in an empty directory, before it adds the scaffold keys. */
export function newManifest(name: string): string {
  return `${JSON.stringify({ name, type: 'module', version: '0.0.0' }, undefined, 2)}\n`;
}
