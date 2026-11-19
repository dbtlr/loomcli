import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { put, removeRoots, temporaryRoot } from './fixture.js';
import { run } from './run.js';

vi.mock(import('node:fs'), async (importOriginal) => {
  const { ceiled } = await import('./ceiling.js');
  return ceiled(await importOriginal());
});

const fixture = (name: string) =>
  readFileSync(new URL(`fixtures/release-formula/${name}`, import.meta.url), 'utf8');

afterEach(removeRoots);

function releasePackage(sums = fixture('SHA256SUMS'), license = 'MIT') {
  const root = temporaryRoot('loom-release-formula-');
  put(
    root,
    'package.json',
    JSON.stringify({
      bin: { 'loom-notes': 'dist/main.js' },
      description: 'Manage release notes',
      homepage: 'https://github.com/fixture/loom-notes',
      license,
      name: '@fixture/notes',
      repository: { url: 'git+https://github.com/fixture/loom-notes.git' },
      version: '1.4.0',
    }),
  );
  put(root, 'release/SHA256SUMS', sums);
  return root;
}

async function formula(root: string) {
  const cwd = join(root, 'release');
  return await run(
    ['release', 'formula', '--checksums', 'SHA256SUMS', '--output', '../loom-notes.rb'],
    { ceiling: root, cwd },
  );
}

test('renders a Homebrew formula for all four release assets', async () => {
  const root = releasePackage();
  await expect(formula(root)).resolves.toMatchObject({ status: 0, stderr: '' });
  expect(readFileSync(join(root, 'loom-notes.rb'), 'utf8')).toBe(fixture('loom-notes.rb'));
});

test('names a missing glibc asset and leaves the previous formula in place', async () => {
  const sums = fixture('SHA256SUMS')
    .split('\n')
    .filter((line) => !line.endsWith('  loom-notes-linux-x64'))
    .join('\n');
  const root = releasePackage(sums);
  const previous = fixture('loom-notes.rb');
  put(root, 'loom-notes.rb', previous);

  await expect(formula(root)).resolves.toEqual({
    status: 1,
    stderr:
      "SHA256SUMS has no SHA-256 checksum for loom-notes-linux-x64. Pass the published release's SHA256SUMS listing that asset with --checksums.\n",
    stdout: '',
  });
  expect(readFileSync(join(root, 'loom-notes.rb'), 'utf8')).toBe(previous);
});

test('refuses conflicting checksums for a required asset', async () => {
  const sums = fixture('SHA256SUMS');
  const conflict = '26bdc30d58c036023989e2b9b03c5de67b581134339d48efc062d538369eb5a7';
  const root = releasePackage(`${sums}${conflict}  loom-notes-darwin-arm64\n`);

  await expect(formula(root)).resolves.toMatchObject({
    status: 1,
    stderr:
      'SHA256SUMS lists different SHA-256 checksums for loom-notes-darwin-arm64. Regenerate SHA256SUMS with one checksum per asset, then run loom release formula again.\n',
  });
});

test('creates the output file’s missing parent folder', async () => {
  const root = releasePackage();
  const cwd = join(root, 'release');
  await expect(
    run(
      ['release', 'formula', '--checksums', 'SHA256SUMS', '--output', '../tap/Formula/notes.rb'],
      {
        ceiling: root,
        cwd,
      },
    ),
  ).resolves.toMatchObject({ status: 0, stderr: '' });
  expect(readFileSync(join(root, 'tap/Formula/notes.rb'), 'utf8')).toContain('class Notes');
});

test.each([
  { license: 'MIT OR Apache-2.0', line: '  license any_of: ["MIT", "Apache-2.0"]\n' },
  {
    license: 'MIT AND BSD-3-Clause AND Apache-2.0',
    line: '  license all_of: ["MIT", "BSD-3-Clause", "Apache-2.0"]\n',
  },
  { license: 'Apache-2.0', line: '  license "Apache-2.0"\n' },
  { license: ' MIT ', line: '  license "MIT"\n' },
])('writes the SPDX license $license as $line', async ({ license, line }) => {
  const root = releasePackage(fixture('SHA256SUMS'), license);
  await expect(formula(root)).resolves.toMatchObject({ status: 0, stderr: '' });
  const written = readFileSync(join(root, 'loom-notes.rb'), 'utf8');
  expect(written).toBe(fixture('loom-notes.rb').replace('  license "MIT"\n', line));
});

test.each([
  '(MIT OR Apache-2.0)',
  '(MIT)',
  'MIT OR AND',
  'MIT AND OR',
  'GPL-2.0-only WITH Classpath-exception-2.0',
  'MIT OR Apache-2.0 AND BSD-3-Clause',
  'MIT OR',
  'MIT Apache-2.0',
])('refuses the SPDX license %s, which a formula cannot state as written', async (license) => {
  const root = releasePackage(fixture('SHA256SUMS'), license);
  await expect(formula(root)).resolves.toEqual({
    status: 1,
    stderr: `package.json's license, ${license}, is an SPDX expression a Homebrew formula cannot state as written. Simplify it to one license, or to licenses joined only by OR or only by AND, then run loom release formula again, or edit the license line of the formula by hand.\n`,
    stdout: '',
  });
  expect(existsSync(join(root, 'loom-notes.rb'))).toBe(false);
});
