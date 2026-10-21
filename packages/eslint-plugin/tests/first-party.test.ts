import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import tsParser from '@typescript-eslint/parser';
import { Linter } from 'eslint';
import { expect, test } from 'vite-plus/test';

import plugin from '../src/index.js';

const root = fileURLToPath(new URL('../../../', import.meta.url));

/** The source directories of the packages and examples Loom ships, which the rules must pass. */
const sourceDirectories = [
  'packages/plugins/src',
  'packages/prompts/src',
  'packages/loom/src',
  ...readdirSync(join(root, 'examples'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => `examples/${entry.name}/src`),
];

/** The TypeScript files under a source directory, relative to the repository root. */
function sourceFiles(directory: string): string[] {
  return readdirSync(join(root, directory), { encoding: 'utf8', recursive: true })
    .filter((path) => path.endsWith('.ts'))
    .map((path) => join(directory, path));
}

const linter = new Linter({ configType: 'flat' });
const config: Linter.Config[] = [
  {
    files: ['**/*.ts'],
    languageOptions: { parser: tsParser, sourceType: 'module' as const },
    ...plugin.configs.recommended,
  },
];

test('the declarations Loom ships in its own packages and examples pass the three rules', () => {
  expect(sourceDirectories).toContain('examples/textstat/src');
  const files = sourceDirectories.flatMap((directory) => sourceFiles(directory));
  expect(files.length).toBeGreaterThan(50);
  const reports = files.flatMap((path) =>
    linter
      .verify(readFileSync(join(root, path), 'utf8'), config, path)
      .map(({ line, message, ruleId }) => `${path}:${line} ${ruleId}: ${message}`),
  );
  expect(reports).toEqual([]);
});

test('the same configuration reports a declaration that breaks a rule, so a pass is not vacuous', () => {
  const code =
    "import { Command } from '@loomcli/core';\nexport const bad = new Command('bad name');\n";
  const ids = linter.verify(code, config, 'packages/loom/src/bad.ts').map(({ ruleId }) => ruleId);
  expect(ids.toSorted((first, second) => String(first).localeCompare(String(second)))).toEqual([
    '@loomcli/name-shape',
    '@loomcli/undescribed',
  ]);
});
