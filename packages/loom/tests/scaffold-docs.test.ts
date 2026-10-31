// @module-tag docs

import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { eslintConfig, oxlintConfig } from '../src/content/scaffold.js';

/** The ESLint plugin reference, which shows the configuration files the scaffold writes. */
const reference = readFileSync(
  new URL('../../../docs/libs/eslint-plugin.md', import.meta.url),
  'utf8',
);

test('the ESLint plugin reference shows the lint files init writes, byte for byte', () => {
  expect(reference).toContain(`\`\`\`json\n${oxlintConfig}\`\`\``);
  expect(reference).toContain(`\`\`\`js\n${eslintConfig('src')}\`\`\``);
});
