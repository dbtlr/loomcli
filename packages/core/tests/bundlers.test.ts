import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

/** The application each bundler bundles, and the script that bundles it. */
const script = fileURLToPath(new URL('fixtures/bundled/bundle.mjs', import.meta.url));

/** How long one bundle or one run may take before the test fails. */
const timeout = 60_000;

/**
 * The padded lines `measure` prints, the same bytes its source run prints: a wide pair, a letter
 * with a combining mark, an emoji sequence, a flag, and ASCII, each padded to six columns.
 */
const measured = ['日本  |', 'é     |', '👩‍💻    |', '🇯🇵    |', 'abc   |', 'source', ''].join('\n');

/**
 * The copyright holders whose notices core's derived modules carry as legal comments: the Unicode
 * tables, the width iterator ported from uucode, and the Inquirer glyph forms.
 */
const holders = ['Unicode, Inc.', 'Tim Culverhouse', 'Simon Boudrias'];

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** One process's output, failing the test when it writes to stderr or does not exit 0. */
function run(command: string, args: string[]) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout });
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/** Each bundler, with the runtime its build runs under. */
const bundlers = [
  { bundler: 'bun', runtime: 'bun' },
  { bundler: 'rolldown', runtime: 'node' },
];

test.each(bundlers)(
  'an application $bundler bundles with no define measures text and reads source under Node and Bun',
  ({ bundler, runtime }) => {
    const outdir = mkdtempSync(join(tmpdir(), `loom-${bundler}-`));
    roots.push(outdir);
    run(runtime, [script, bundler, outdir]);
    const bundle = join(outdir, 'main.js');
    expect(run('node', [bundle, 'measure'])).toBe(measured);
    expect(run('bun', [bundle, 'measure'])).toBe(measured);
  },
);

test.each(bundlers)(
  'an application $bundler bundles with no define writes the Developer Diagnostic for a defect under Node and Bun',
  ({ bundler, runtime }) => {
    const outdir = mkdtempSync(join(tmpdir(), `loom-${bundler}-`));
    roots.push(outdir);
    run(runtime, [script, bundler, outdir]);
    const bundle = join(outdir, 'main.js');
    for (const command of ['node', 'bun']) {
      const result = spawnSync(command, [bundle, 'fail'], { encoding: 'utf8', timeout });
      expect(result.status).toBe(1);
      expect(result.stdout).toBe('');
      expect(result.stderr).toMatch(
        /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nThe bundle failed\.\n/u,
      );
    }
  },
);

test.each(bundlers)(
  'an application $bundler bundles keeps the license notices of core',
  ({ bundler, runtime }) => {
    const outdir = mkdtempSync(join(tmpdir(), `loom-${bundler}-`));
    roots.push(outdir);
    run(runtime, [script, bundler, outdir]);
    const bundle = readFileSync(join(outdir, 'main.js'), 'utf8');
    for (const holder of holders) {
      expect(bundle).toContain(holder);
    }
  },
);

test('the source run prints the bytes the bundles print', () => {
  const source = fileURLToPath(new URL('fixtures/bundled/main.mjs', import.meta.url));
  expect(run('node', [source, 'measure'])).toBe(measured);
});
