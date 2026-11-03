import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
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
 * one: MIT, with four completion scripts ported from an Apache-2.0 project. `files` adds or
 * replaces files by path, and `omit` leaves files out.
 */
function repository(options: {
  readonly bundled: readonly string[];
  readonly files?: Readonly<Record<string, string>>;
  readonly license: string;
  readonly omit?: readonly string[];
}) {
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
  Object.assign(files, options.files);
  for (const path of options.omit ?? []) {
    delete files[path];
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

test('a material table that no longer describes a workspace package fails the build', () => {
  const pluginsManifest = JSON.stringify({
    license: 'MIT',
    name: '@loomcli/plugins',
    version: '1.0.0',
  });
  const narrowed = { files: { 'packages/plugins/package.json': pluginsManifest } };
  const renamed = { omit: ['packages/plugins/dist/src/completion/fish.js'] };
  const ported = { files: { 'packages/plugins/licenses/port-LICENSE.txt': 'MIT License' } };
  const unlisted = {
    files: { 'packages/plugins/dist/src/completion/elvish.js': '// Copyright The Cobra Authors' },
  };

  expect(() =>
    writeNotices(repository({ bundled: [helpPage], license: 'MIT', ...narrowed })),
  ).toThrow(/@loomcli\/plugins is licensed MIT, but the material table/);
  expect(() =>
    writeNotices(repository({ bundled: [helpPage], license: 'MIT', ...renamed })),
  ).toThrow(/completion\/fish\.js, which does not exist/);
  expect(() =>
    writeNotices(repository({ bundled: [helpPage], license: 'MIT', ...ported })),
  ).toThrow(/ships licenses\/port-LICENSE\.txt, which no entry of the material table/);
  expect(() =>
    writeNotices(repository({ bundled: [helpPage], license: 'MIT', ...unlisted })),
  ).toThrow(
    /completion\/elvish\.js states a copyright or a port, but no entry of the material table/,
  );
});

test('a workspace package with a NOTICE and no material entry fails the build', () => {
  const root = repository({
    bundled: ['validators/dist/index.js'],
    files: {
      'packages/validators/LICENSE': 'MIT License',
      'packages/validators/NOTICE': 'Ported notice',
      'packages/validators/package.json': JSON.stringify({
        license: 'MIT',
        name: '@loomcli/validators',
        version: '1.0.0',
      }),
    },
    license: 'MIT',
  });

  expect(() => writeNotices(root)).toThrow(/@loomcli\/validators ships a NOTICE/);
});

test('modules of the loom package itself need no notice', () => {
  const root = repository({
    bundled: ['src/helpers/release.ts', 'package.json', 'loom/src/main.ts'],
    license: 'MIT',
  });

  writeNotices(root);

  expect(readFileSync(join(root, 'packages/loom/dist/NOTICE'), 'utf8')).not.toContain('License:');
});

test('a scoped third-party package carries its notice and license texts, and stale ones go', () => {
  const store = 'node_modules/.pnpm/@scope+kit@1.0.0/node_modules/@scope/kit';
  const root = repository({
    bundled: [`${store}/index.js`],
    files: {
      [`${store}/LICENSE`]: 'MIT License',
      [`${store}/NOTICE`]: 'Kit notice',
      [`${store}/licenses/vendored-LICENSE.txt`]: 'MIT License',
      [`${store}/package.json`]: JSON.stringify({
        license: 'MIT',
        name: '@scope/kit',
        version: '1.0.0',
      }),
      'packages/loom/dist/licenses/stale-LICENSE': 'Old license',
    },
    license: 'MIT',
  });

  writeNotices(root);

  const licenses = join(root, 'packages/loom/dist/licenses');
  expect(readdirSync(licenses).toSorted()).toEqual([
    '@scope__kit-LICENSE',
    '@scope__kit-NOTICE',
    '@scope__kit-vendored-LICENSE.txt',
  ]);
});
