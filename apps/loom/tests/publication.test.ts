import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

const cli = fileURLToPath(new URL('../dist/main.js', import.meta.url));
const roots: string[] = [];
function run(root: string, command: string, args: string[], env = process.env) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env, timeout: 120_000 });
  if (result.error) {
    throw result.error;
  }
  return { status: result.status, stderr: result.stderr, stdout: result.stdout };
}
function git(root: string, ...args: string[]) {
  const result = run(root, 'git', args);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  return result.stdout.trim();
}
function put(root: string, path: string, body: string) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), body);
}
function commit(root: string) {
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'commit',
    '-qm',
    'fixture',
  );
  return git(root, 'rev-parse', 'HEAD');
}
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'loom-publication-'));
  roots.push(root);
  git(root, 'init', '-q');
  git(root, 'config', 'core.autocrlf', 'false');
  put(root, '.changes/README.md', '# Guide\n');
  put(root, '.changes/first.md', '- Add the initial library.\n');
  put(root, '.gitignore', 'node_modules\ndist\n');
  put(root, 'CHANGELOG.md', '# Changelog\n\n');
  put(root, 'pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  put(
    root,
    'package.json',
    JSON.stringify({ name: 'fixture', private: true, scripts: { verify: 'node build.cjs' } }),
  );
  put(
    root,
    'build.cjs',
    "if (process.env.LOOM_REFUSE_BUILD) throw new Error('Release rebuild forbidden'); const fs = require('node:fs'); fs.mkdirSync('packages/core/dist', {recursive:true}); fs.copyFileSync('packages/core/index.js','packages/core/dist/index.js'); fs.copyFileSync('packages/core/index.d.ts','packages/core/dist/index.d.ts');\n",
  );
  put(
    root,
    'packages/core/package.json',
    JSON.stringify({
      exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
      files: ['dist'],
      name: '@sample/core',
      type: 'module',
      version: '0.0.0',
    }),
  );
  put(root, 'packages/core/index.js', 'export const value = 42;\n');
  put(root, 'packages/core/index.d.ts', 'export declare const value: 42;\n');
  const base = commit(root);
  return { base, output: join(root, '..', `${root.split(/[\\/]/u).at(-1)}-set`), root };
}
function invoke(root: string, args: string[], env = process.env) {
  return run(root, process.env.LOOM_TEST_RUNTIME ?? 'node', [cli, 'publication', ...args], env);
}
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

test('preparation requires a compiler-validated release identity before producing artifacts', () => {
  const { root, base, output } = fixture();
  const result = invoke(root, [
    'prepare',
    '--base',
    base,
    '--head',
    base,
    '--title',
    'Fix output',
    '--output',
    output,
  ]);
  expect(result).toMatchObject({ status: 1, stderr: expect.stringContaining('release title') });
});

test('a prepared set survives download and verification without rebuilding source contents', () => {
  const { root, base, output } = fixture();
  roots.push(output);
  const cut = run(root, 'node', [cli, 'changelog', 'write', '--initial', '--date', '2026-09-08']);
  expect(cut).toMatchObject({ status: 0, stderr: '' });
  const head = commit(root);
  const args = [
    'prepare',
    '--base',
    base,
    '--head',
    head,
    '--title',
    'chore(release): Release v0.1.0 - Initial library',
    '--output',
    output,
  ];
  const prepared = invoke(root, args);
  expect(prepared).toMatchObject({ status: 0, stderr: '' });
  const result = z
    .object({ base: z.string(), digest: z.string(), source: z.string(), version: z.string() })
    .parse(JSON.parse(prepared.stdout));
  expect(result).toMatchObject({
    base,
    digest: expect.stringMatching(/^[a-f0-9]{64}$/u),
    source: head,
    version: '0.1.0',
  });
  const original = readFileSync(join(output, 'package-0.tgz'));
  const record = JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8'));
  expect(record.fragments).toEqual([{ content: '- Add the initial library.\n', name: 'first.md' }]);
  expect(record.packages).toEqual([
    expect.objectContaining({
      file: 'package-0.tgz',
      integrity: expect.stringMatching(/^sha512-/u),
      name: '@sample/core',
      version: '0.1.0',
    }),
  ]);
  put(root, 'build.cjs', 'throw new Error("A retry must not rebuild");\n');
  commit(root);
  const downloaded = `${output}-downloaded`;
  roots.push(downloaded);
  cpSync(output, downloaded, { recursive: true });
  const verified = invoke(
    root,
    ['verify', '--artifacts', downloaded, '--digest', result.digest, '--head', head],
    { ...process.env, LOOM_REFUSE_BUILD: '1' },
  );
  expect(verified).toMatchObject({ status: 0, stderr: '' });
  expect(readFileSync(join(output, 'package-0.tgz'))).toEqual(original);
  expect(invoke(root, args).stderr).toContain('already exists');
  expect(
    invoke(root, ['verify', '--artifacts', output, '--digest', result.digest, '--head', base])
      .stderr,
  ).toContain('source');
  const manifestBytes = readFileSync(join(output, 'manifest.json'));
  writeFileSync(
    join(output, 'manifest.json'),
    manifestBytes.toString('utf8').replace('Add the initial library.', 'Forged fragment.'),
  );
  expect(
    invoke(root, ['verify', '--artifacts', output, '--digest', result.digest, '--head', head])
      .stderr,
  ).toContain('digest');
  const forgedDigest = createHash('sha256')
    .update(readFileSync(join(output, 'manifest.json')))
    .digest('hex');
  expect(
    invoke(root, ['verify', '--artifacts', output, '--digest', forgedDigest, '--head', head])
      .stderr,
  ).toContain('consumed fragments');
  writeFileSync(join(output, 'manifest.json'), manifestBytes);
  git(
    root,
    '-c',
    'user.name=Test',
    '-c',
    'user.email=test@example.com',
    'tag',
    '-a',
    'v0.1.0',
    head,
    '-m',
    'Release',
  );
  expect(
    invoke(root, ['verify', '--artifacts', output, '--digest', result.digest, '--head', head]),
  ).toMatchObject({ status: 0, stderr: '' });
  git(root, 'tag', '-d', 'v0.1.0');
  git(root, 'tag', 'v0.1.0', head);
  expect(
    invoke(root, ['verify', '--artifacts', output, '--digest', result.digest, '--head', head])
      .stderr,
  ).toContain('annotated');
  git(root, 'tag', '-d', 'v0.1.0');
  writeFileSync(join(output, 'package-0.tgz'), 'corrupted');
  expect(
    invoke(root, ['verify', '--artifacts', output, '--digest', result.digest, '--head', head])
      .stderr,
  ).toContain('integrity');
}, 120_000);

test.each([
  {
    content: 'export declare const value: MissingType;\n',
    diagnostic: 'MissingType',
    path: 'packages/core/index.d.ts',
  },
  {
    content:
      "require('node:fs').mkdirSync('packages/core/dist', {recursive:true}); require('node:fs').writeFileSync('packages/core/dist/index.js', 'export const value = 42;');\n",
    diagnostic: 'Missing packed export target',
    path: 'build.cjs',
  },
  {
    content: JSON.stringify({
      exports: { '.': { import: './dist/index.js', types: './dist/index.d.ts' } },
      files: ['dist'],
      name: '@sample/core',
      publishConfig: {
        exports: { '.': { import: './dist/wrong.js', types: './dist/index.d.ts' } },
      },
      type: 'module',
      version: '0.0.0',
    }),
    diagnostic: 'packed exports',
    path: 'packages/core/package.json',
  },
])(
  'preparation rejects an invalid packed consumer: $diagnostic',
  ({ path, content, diagnostic }) => {
    const { root, output } = fixture();
    roots.push(output);
    put(root, path, content);
    const base = commit(root);
    const cut = run(root, 'node', [cli, 'changelog', 'write', '--initial', '--date', '2026-09-08']);
    expect(cut).toMatchObject({ status: 0, stderr: '' });
    const head = commit(root);
    const prepared = invoke(root, [
      'prepare',
      '--base',
      base,
      '--head',
      head,
      '--title',
      'chore(release): Release v0.1.0 - Initial library',
      '--output',
      output,
    ]);
    expect(prepared.status).toBe(1);
    expect(prepared.stderr).toContain(diagnostic);
    expect(existsSync(output)).toBe(false);
  },
  120_000,
);

test('participating dependencies pack at the same exact version and install together', () => {
  const { root, output } = fixture();
  roots.push(output);
  const original = z
    .record(z.string(), z.unknown())
    .parse(JSON.parse(readFileSync(join(root, 'packages/core/package.json'), 'utf8')));
  put(
    root,
    'packages/core/package.json',
    JSON.stringify({ ...original, dependencies: { '@sample/other': 'workspace:*' } }),
  );
  put(root, 'packages/core/index.js', "export { value } from '@sample/other';\n");
  put(root, 'packages/core/index.d.ts', "export { value } from '@sample/other';\n");
  put(
    root,
    'packages/other/package.json',
    JSON.stringify({
      exports: { '.': { import: './index.js', types: './index.d.ts' } },
      files: ['index.js', 'index.d.ts'],
      name: '@sample/other',
      type: 'module',
      version: '0.0.0',
    }),
  );
  put(root, 'packages/other/index.js', 'export const value = 42;\n');
  put(root, 'packages/other/index.d.ts', 'export declare const value: 42;\n');
  const base = commit(root);
  expect(
    run(root, 'node', [cli, 'changelog', 'write', '--initial', '--date', '2026-09-08']),
  ).toMatchObject({ status: 0, stderr: '' });
  const head = commit(root);
  const prepared = invoke(root, [
    'prepare',
    '--base',
    base,
    '--head',
    head,
    '--title',
    'chore(release): Release v0.1.0 - Initial libraries',
    '--output',
    output,
  ]);
  expect(prepared).toMatchObject({ status: 0, stderr: '' });
  const record = z
    .object({ packages: z.array(z.object({ name: z.string(), version: z.string() })) })
    .parse(JSON.parse(readFileSync(join(output, 'manifest.json'), 'utf8')));
  expect(record.packages).toEqual([
    { name: '@sample/core', version: '0.1.0' },
    { name: '@sample/other', version: '0.1.0' },
  ]);
}, 120_000);
