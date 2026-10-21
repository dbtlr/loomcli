import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

/** The oxlint configuration file, which holds the whole configuration. */
const oxlintConfigPath = '.oxlintrc.json';

/** The ESLint flat-config file init writes, which is also the first name ESLint looks for. */
const eslintConfigPath = 'eslint.config.js';

/** Every name ESLint reads its flat configuration from. */
const eslintConfigNames = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map(
  (extension) => `eslint.config.${extension}`,
);

/**
 * The linter command of the `check` script. oxlint lints `src` alone, because it skips
 * `node_modules` only where a `.gitignore` names it, which a new scaffold does not have yet.
 */
const lintCommands: Record<Linter, string> = { eslint: 'eslint .', oxlint: 'oxlint src' };

/** The test command of each runner. */
const testCommands: Record<TestRunner, string> = { bun: 'bun test', vitest: 'vitest run' };

/** The linters a scaffold can wire, the default first. */
export const linters = ['oxlint', 'eslint'] as const;

/** The test runners a scaffold can wire, the default first. */
export const testRunners = ['bun', 'vitest'] as const;

export type Linter = (typeof linters)[number];
export type TestRunner = (typeof testRunners)[number];

/** The linter and the test runner a scaffold's files, `check` script, and dev dependencies serve. */
export interface Tooling {
  readonly linter: Linter;
  readonly runner: TestRunner;
}

/** The tooling a scaffold uses when nothing says otherwise. */
export const defaultTooling: Tooling = { linter: linters[0], runner: testRunners[0] };

/** The optional peer dependencies of `@loomcli/loom` that name a tool package a scaffold pins. */
export const toolRanges = z.object({
  '@types/bun': z.string(),
  eslint: z.string(),
  oxlint: z.string(),
  typescript: z.string(),
  'typescript-eslint': z.string(),
  vitest: z.string(),
});

/** The range of each tool package, by package name. */
export type ToolRanges = z.infer<typeof toolRanges>;

export type ToolPackage = keyof ToolRanges;

/** The path of the lint configuration file init writes for a linter. */
export function lintConfigPath(linter: Linter): string {
  return linter === 'oxlint' ? oxlintConfigPath : eslintConfigPath;
}

/** Whether the package directory already holds a configuration file of the linter. */
export function hasLintConfig(directory: string, linter: Linter): boolean {
  const names = linter === 'oxlint' ? [oxlintConfigPath] : eslintConfigNames;
  return names.some((name) => existsSync(join(directory, name)));
}

/**
 * The linter a package already configures, else `undefined`. An oxlint configuration wins over an
 * ESLint one, because oxlint is the default.
 */
export function existingLinter(directory: string): Linter | undefined {
  return linters.find((linter) => hasLintConfig(directory, linter));
}

/** The `check` script of a scaffold: the type check, the linter, and the test runner. */
export function checkScript({ linter, runner }: Tooling): string {
  return `tsc --noEmit && ${lintCommands[linter]} && ${testCommands[runner]}`;
}

/** The tool packages the linter and the runner need as development dependencies. */
export function toolDependencies({ linter, runner }: Tooling): ToolPackage[] {
  return [
    ...(linter === 'oxlint' ? (['oxlint'] as const) : (['eslint', 'typescript-eslint'] as const)),
    ...(runner === 'bun' ? (['@types/bun'] as const) : (['vitest'] as const)),
  ];
}
