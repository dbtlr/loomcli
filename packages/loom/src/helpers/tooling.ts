import { existsSync } from 'node:fs';
import { join } from 'node:path';

/** The oxlint configuration file init writes, which holds the whole configuration. */
const oxlintConfigPath = '.oxlintrc.json';

/**
 * Every name oxlint reads its configuration from in a directory, which the oxlint version of
 * `toolRanges` documents. oxlint refuses to run when a directory holds more than one, so init
 * writes `.oxlintrc.json` only beside none of them.
 */
const oxlintConfigNames = [
  oxlintConfigPath,
  '.oxlintrc.jsonc',
  'oxlint.config.ts',
  'oxlint.config.mts',
];

/** The ESLint flat-config file init writes, which is also the first name ESLint looks for. */
const eslintConfigPath = 'eslint.config.js';

/** Every name ESLint reads its flat configuration from. */
const eslintConfigNames = ['js', 'mjs', 'cjs', 'ts', 'mts', 'cts'].map(
  (extension) => `eslint.config.${extension}`,
);

/**
 * The linter command of the `check` script for the source folder. oxlint lints the source folder
 * alone, because it skips `node_modules` only where a `.gitignore` names it, which a new scaffold
 * does not have yet.
 */
const lintCommands: Record<Linter, (source: string) => string> = {
  eslint: () => 'eslint .',
  oxlint: (source) => `oxlint ${source}`,
};

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

/**
 * The range init writes for each tool package of a scaffold, other than TypeScript's own, which
 * `@loomcli/loom` declares as its optional peer. Each range is bumped by hand.
 * `@typescript/typescript6` is the TypeScript 6 compatibility package that an ESLint scaffold
 * aliases as `typescript`, because typescript-eslint supports TypeScript below 6.1 and reads the
 * TypeScript 6 API. Remove that alias, and this entry, once typescript-eslint supports
 * TypeScript 7.
 */
export const toolRanges = {
  '@types/bun': '^1.4.3',
  '@typescript/typescript6': '^6.0.2',
  eslint: '^10.13.0',
  oxlint: '^1.89.0',
  'typescript-eslint': '^8.72.0',
  vitest: '^5.0.5',
} as const;

export type ToolPackage = keyof typeof toolRanges;

/** The path of the lint configuration file init writes for a linter. */
export function lintConfigPath(linter: Linter): string {
  return linter === 'oxlint' ? oxlintConfigPath : eslintConfigPath;
}

/** Whether the package directory already holds a configuration file of the linter. */
export function hasLintConfig(directory: string, linter: Linter): boolean {
  const names = linter === 'oxlint' ? oxlintConfigNames : eslintConfigNames;
  return names.some((name) => existsSync(join(directory, name)));
}

/**
 * The linter a package already configures, else `undefined`. An oxlint configuration wins over an
 * ESLint one, because oxlint is the default.
 */
export function existingLinter(directory: string): Linter | undefined {
  return linters.find((linter) => hasLintConfig(directory, linter));
}

/**
 * The `check` script of a scaffold: the type check, the linter over `source`, the source folder
 * relative to the package directory, and the test runner.
 */
export function checkScript({ linter, runner }: Tooling, source: string): string {
  return `tsc --noEmit && ${lintCommands[linter](source)} && ${testCommands[runner]}`;
}

/** The tool packages the linter and the runner need as development dependencies. */
export function toolDependencies({
  linter,
  runner,
}: Tooling): Exclude<ToolPackage, '@typescript/typescript6'>[] {
  return [
    ...(linter === 'oxlint' ? (['oxlint'] as const) : (['eslint', 'typescript-eslint'] as const)),
    ...(runner === 'bun' ? (['@types/bun'] as const) : (['vitest'] as const)),
  ];
}
