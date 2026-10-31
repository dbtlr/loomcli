import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { inspection, run } from './run.js';

/** The application's own manifest, which is where its declared version comes from. */
const manifest = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

const application = [
  'textstat',
  'Count bytes, words, or lines across text sources.',
  'Textstat counts files and piped text in order. Use - to place stdin among the files.',
  '  textstat one.txt two.txt',
  '  textstat --metric words --total *.md',
  '',
].join('\n');

/** What one invocation of the inspection fixture reports about the installed plugin. */
const inspected = z.object({
  globals: z.array(z.object({ name: z.string() })),
  root: z.object({ extensions: z.record(z.string(), z.unknown()) }),
  version: z.string(),
});

/** Every case runs the built application in an empty throwaway directory. */
async function withDirectory(body: (cwd: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-explain-'));
  try {
    await body(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test.each(['--explain', '-e'])(
  'textstat %s explains the application and reads no file',
  async (spelling) => {
    await withDirectory(async (cwd) => {
      await expect(run([spelling], { cwd })).resolves.toEqual({
        status: 0,
        stderr: '',
        stdout: application,
      });
    });
  },
);

test('textstat explains an otherwise invalid invocation instead of rejecting it', async () => {
  // The named file fails preparation, but the explain takeover keeps that input fault held.
  await withDirectory(async (cwd) => {
    await expect(run(['missing.txt', '--explain'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: application,
    });
  });
});

test('an unknown option on the root gains the hint that names the application alone', async () => {
  await withDirectory(async (cwd) => {
    await expect(run(['--bogus'], { cwd })).resolves.toEqual({
      status: 2,
      stderr:
        'textstat: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\nRun "textstat --help" to see the usage.\nRun "textstat --explain" to explain this command.\n',
      stdout: '',
    });
  });
});

test("the inspected graph carries the plugin's option, the extension value, and the version", async () => {
  const result = inspection();
  const graph = inspected.parse(JSON.parse(result));
  expect(graph.version).toBe(manifest.version);
  expect(graph.globals.map((option) => option.name)).toEqual([
    'help',
    'version',
    'manifest',
    'config',
    'no-config',
    'explain',
  ]);
  // The two plugins define separate facts, so one declaration carries a value for each.
  // Help also supplies its value to the manifest's collecting extension, with no manifest installed.
  expect(graph.root.extensions).toEqual({
    '@loom/explain/command': {
      details:
        'Textstat counts files and piped text in order. Use - to place stdin among the files.',
      examples: ['textstat one.txt two.txt', 'textstat --metric words --total *.md'],
    },
    '@loomcli/plugins/help/command': {
      details:
        'Textstat counts files and piped text in order. Use - to place stdin among the files.',
      examples: [{ command: 'one.txt two.txt' }, { command: '--metric words --total *.md' }],
      optionSections: [
        ['Counting', 'Measure'],
        ['Counting', 'Filter'],
        ['Counting', 'Summary'],
        ['Options'],
      ],
    },
    '@loomcli/plugins/manifest/command': [
      {
        details:
          'Textstat counts files and piped text in order. Use - to place stdin among the files.',
        examples: [{ command: 'one.txt two.txt' }, { command: '--metric words --total *.md' }],
      },
    ],
  });
});
