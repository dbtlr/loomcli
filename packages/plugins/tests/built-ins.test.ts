/*
 * The plugins' built-in loader, `src/built-ins.ts`, is ADR-0135's one exception to the ban on the
 * `process` global: it loads a costly built-in module on first use. These cases pin what it may
 * load and show that a run which hashes and stages no file never loads `node:crypto`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The loader's source with its comments removed, so only code is read. */
function loaderCode(): string {
  const source = readFileSync(new URL('../src/built-ins.ts', import.meta.url), 'utf8');
  return source.replaceAll(/\/\*[\s\S]*?\*\//gu, '').replaceAll(/\/\/.*$/gmu, '');
}

test('the built-in loader names node:crypto alone, through a literal specifier', () => {
  const code = loaderCode();
  const calls = [...code.matchAll(/getBuiltinModule\((?<specifier>[^)]*)\)/gu)].map(
    (found) => found.groups?.specifier,
  );
  expect(calls).toEqual(["'node:crypto'"]);
});

test('the built-in loader reads nothing from the process but getBuiltinModule', () => {
  const reads = [...loaderCode().matchAll(/\bprocess\b(?<member>\.\w+)?/gu)].map(
    (found) => found.groups?.member,
  );
  expect(new Set(reads)).toEqual(new Set(['.getBuiltinModule']));
});

/** The fixture that runs an application which installs `selfUpdate()`, under Node. */
const fixture = new URL('fixtures/built-ins-run.mjs', import.meta.url);

test('a run of an application that installs self-update hashes and stages no file and loads no node:crypto', () => {
  const directory = mkdtempSync(join(tmpdir(), 'loom-built-ins-'));
  const marks = join(directory, 'marks.txt');
  writeFileSync(marks, '');
  try {
    const result = invoke(fixture, ['add'], {
      env: { HOME: directory, LOOM_FIXTURE_MARKS: marks },
      runtime: 'node',
    });
    expect(result.stderr).toContain('Added note 12.');
    expect(result.status).toBe(0);
    expect(readFileSync(marks, 'utf8')).toBe('');
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
