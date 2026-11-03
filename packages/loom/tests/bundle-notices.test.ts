import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { writeNotices } from '../../../scripts/bundle-notices.mjs';

/** The temporary repositories this file built, removed after each test. */
const repositories: string[] = [];

afterEach(() => {
  for (const directory of repositories.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

const completionScripts = ['bash', 'zsh', 'fish', 'powershell'].map(
  (shell) => `packages/plugins/dist/src/completion/${shell}.js`,
);

/**
 * A repository whose loom bin bundles the modules named, by the path Bun writes in its module
 * comments, with the given license field on the loom package. Its plugins package mirrors the real
 * one: MIT, with four completion scripts ported from an Apache-2.0 project.
 */
function repository(options: { readonly bundled: readonly string[]; readonly license: string }) {
  const root = mkdtempSync(join(tmpdir(), 'loom-notices-'));
  repositories.push(root);
  const files: Record<string, string> = {
    'node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/LICENSE': 'ISC License',
    'node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/package.json': JSON.stringify({
      license: 'ISC',
      name: 'yaml',
      version: '2.9.1',
    }),
    'package.json': JSON.stringify({ license: 'MIT' }),
    'packages/loom/LICENSE': 'MIT License',
    'packages/loom/dist/main.js': options.bundled.map((path) => `// ../../../${path}\n`).join(''),
    'packages/loom/package.json': JSON.stringify({
      license: options.license,
      name: '@loomcli/loom',
    }),
    'packages/plugins/LICENSE': 'MIT License',
    'packages/plugins/NOTICE': 'Cobra notice',
    'packages/plugins/dist/src/help/page.js': '',
    'packages/plugins/licenses/cobra-LICENSE.txt': 'Apache License',
    'packages/plugins/package.json': JSON.stringify({
      license: 'MIT AND Apache-2.0',
      name: '@loomcli/plugins',
      version: '1.0.0',
    }),
  };
  for (const script of completionScripts) {
    files[script] = '';
  }
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), content);
  }
  return root;
}

const helpPage = 'plugins/dist/src/help/page.js';
const bashCompletion = 'plugins/dist/src/completion/bash.js';

test('a workspace package counts only the licenses of the files the bundle holds', () => {
  const root = repository({ bundled: [helpPage], license: 'MIT' });

  writeNotices(root);

  const distribution = join(root, 'packages/loom/dist');
  expect(readFileSync(join(distribution, 'NOTICE'), 'utf8')).toContain(
    '@loomcli/plugins 1.0.0\nLicense: MIT\n',
  );
  expect(existsSync(join(distribution, 'licenses/@loomcli__plugins-LICENSE'))).toBe(true);
  expect(existsSync(join(distribution, 'licenses/@loomcli__plugins-cobra-LICENSE.txt'))).toBe(
    false,
  );
  expect(existsSync(join(distribution, 'licenses/@loomcli__plugins-NOTICE'))).toBe(false);
});

test('a bundled ported file requires its license and carries its notice', () => {
  expect(() => writeNotices(repository({ bundled: [bashCompletion], license: 'MIT' }))).toThrow(
    /does not include Apache-2\.0/,
  );

  const root = repository({ bundled: [helpPage, bashCompletion], license: 'MIT AND Apache-2.0' });
  writeNotices(root);

  const distribution = join(root, 'packages/loom/dist');
  expect(readFileSync(join(distribution, 'NOTICE'), 'utf8')).toContain(
    '@loomcli/plugins 1.0.0\nLicense: MIT AND Apache-2.0\n',
  );
  expect(existsSync(join(distribution, 'licenses/@loomcli__plugins-cobra-LICENSE.txt'))).toBe(true);
  expect(existsSync(join(distribution, 'licenses/@loomcli__plugins-NOTICE'))).toBe(true);
});

test('a license no bundled module needs fails the build', () => {
  const root = repository({ bundled: [helpPage], license: 'MIT AND Apache-2.0' });

  expect(() => writeNotices(root)).toThrow(/declares Apache-2\.0, which no bundled module needs/);
});

test('a third-party package from the pnpm store requires its whole license', () => {
  const yaml = 'node_modules/.pnpm/yaml@2.9.1/node_modules/yaml/dist/index.js';

  expect(() => writeNotices(repository({ bundled: [yaml], license: 'MIT' }))).toThrow(
    /does not include ISC/,
  );
  expect(() => writeNotices(repository({ bundled: [yaml], license: 'MIT AND ISC' }))).not.toThrow();
});

test('a module from outside the store and the workspace packages fails the build', () => {
  const root = repository({ bundled: ['vendor/left-pad.js'], license: 'MIT' });

  expect(() => writeNotices(root)).toThrow(/vendor\/left-pad\.js/);
});
