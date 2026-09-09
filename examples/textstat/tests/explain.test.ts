import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);

/** The application's own manifest, which is where its declared version comes from. */
const manifest = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

const application = [
  'textstat',
  'Count bytes, words, or lines across text sources.',
  'With no files, textstat counts the text piped to it and names the source "stdin".',
  '  textstat one.txt two.txt',
  '  textstat --metric words --total *.md',
  '',
].join('\n');

/** What one invocation of the inspection fixture reports about the installed plugin. */
const inspected = z.object({
  globals: z.array(z.object({ name: z.string(), scope: z.string() })),
  root: z.object({ extensions: z.record(z.string(), z.unknown()) }),
  version: z.string(),
});

/** Every case runs the built application in an empty throwaway directory. */
function withDirectory(run: (cwd: string) => void) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-explain-'));
  try {
    run(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('textstat explains the application and reads no file', () => {
  withDirectory((cwd) => {
    expect(invoke(main, ['--explain'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: application,
    });
  });
});

test('textstat explains an otherwise invalid invocation instead of rejecting it', () => {
  // The named file does not exist, so a run that reached the action would fail reading it.
  withDirectory((cwd) => {
    expect(invoke(main, ['missing.txt', '--explain'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: application,
    });
  });
});

test('the inspected graph carries the plugin option, the extension value, and the version', () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result.status).toBe(0);
  const graph = inspected.parse(JSON.parse(result.stdout));
  expect(graph.version).toBe(manifest.version);
  expect(graph.globals.map((option) => [option.name, option.scope])).toEqual([
    ['explain', 'plugin'],
  ]);
  expect(graph.root.extensions).toEqual({
    '@loom/explain/command': {
      details: 'With no files, textstat counts the text piped to it and names the source "stdin".',
      examples: ['textstat one.txt two.txt', 'textstat --metric words --total *.md'],
    },
  });
});
