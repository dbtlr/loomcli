// Acceptance plan: see packages/plugins/tests/manifest.test.ts.
import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { withDocuments } from './documents.js';
import { printed, run } from './run.js';

/** A pinned document, checked by hand against the manifest contract's rules. */
function pinned(name: string): string {
  return readFileSync(new URL(`fixtures/manifest/${name}.json`, import.meta.url), 'utf8');
}

test('jsonkit --manifest prints the whole application, omitting the hidden paths and debug', async () => {
  await expect(run(['--manifest'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: pinned('root'),
  });
});

test('jsonkit get --manifest prints the get slice while its required path is missing', async () => {
  await expect(run(['get', '--manifest'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: pinned('get'),
  });
});

test.each([{ route: [] }, { route: ['get'] }])(
  'jsonkit $route -M prints the routed manifest without dispatching',
  async ({ route }) => {
    const result = await run([...route, '-M']);
    expect(result).toMatchObject({ status: 0, stderr: '' });
    expect(result).toEqual(await run([...route, '--manifest']));
  },
);

test('jsonkit --help --manifest prints help and --version --manifest the version, by installation order', async () => {
  await expect(printed(['--help', '--manifest'])).resolves.toMatch(/^jsonkit · /u);
  await expect(printed(['--version', '--manifest'])).resolves.toBe('jsonkit v0.0.0\n');
});

/** The routed entry's name, description, and deprecation, parsed at the boundary. */
const routed = z.object({
  command: z.object({
    deprecated: z.string().nullable(),
    description: z.string().nullable(),
    name: z.string().nullable(),
  }),
});

test('jsonkit fetch --manifest carries the deprecation, and debug --manifest prints the hidden slice', async () => {
  const fetch = routed.parse(JSON.parse(await printed(['fetch', '--manifest'])));
  expect(fetch.command).toEqual({
    deprecated: 'Use get instead.',
    description: 'Read one value at a path.',
    name: 'fetch',
  });
  const debug = routed.parse(JSON.parse(await printed(['debug', '--manifest'])));
  expect(debug.command).toEqual({
    deprecated: null,
    description: 'Dump the parsed document.',
    name: 'debug',
  });
  expect(pinned('root')).not.toContain('"name": "debug"');
});

test('jsonkit stats depth max --manifest prints the slice of the Command three levels down', async () => {
  const max = routed.parse(JSON.parse(await printed(['stats', 'depth', 'max', '--manifest'])));
  expect(max.command).toEqual({
    deprecated: null,
    description: 'Print the deepest nesting level under a path.',
    name: 'max',
  });
});

/** The routed entry's declared failures, parsed at the boundary. */
const declared = z.object({
  command: z.object({
    failures: z.array(z.object({ code: z.string(), exitCode: z.number(), meaning: z.string() })),
  }),
});

test('the hidden Commands that read a document declare invalid-json, and the table names it once', async () => {
  const invalidJson = {
    code: 'invalid-json',
    exitCode: 65,
    meaning: 'The document is not valid JSON.',
  };
  for (const name of ['debug', 'paths']) {
    const manifest: unknown = JSON.parse(await printed([name, '--manifest']));
    expect(declared.parse(manifest).command.failures).toEqual([invalidJson]);
  }
  expect(pinned('root')).toContain('"65": "Declared failures: invalid-json, path-not-found"');
});

test.each([
  [[], ['--file', 'malformed.json']],
  [['get'], ['get', 'name', '--file', 'malformed.json']],
  [['keys'], ['keys', '--file', 'malformed.json']],
  [['fetch'], ['fetch', 'name', '--file', 'malformed.json']],
  [['paths'], ['paths', '--file', 'malformed.json']],
  [['debug'], ['debug', '--file', 'malformed.json']],
])('%j exits with the code its manifest declares for invalid-json', async (route, args) => {
  const manifest: unknown = JSON.parse(await printed([...route, '--manifest']));
  const declaredCode = declared
    .parse(manifest)
    .command.failures.find((failure) => failure.code === 'invalid-json')?.exitCode;
  expect(declaredCode).toBe(65);
  await withDocuments({ 'malformed.json': '{"name":' }, async (cwd) => {
    const { status } = await run(args, { cwd });
    expect(status).toBe(declaredCode);
  });
});
