import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

/** The application's own manifest, which is where its declared version comes from. */
const manifest = z
  .object({ version: z.string() })
  .parse(JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')));

const command = [
  'jsonkit get',
  'Read one value at a path.',
  'A path is a dot-separated walk from the root of the document.',
  '  jsonkit get name -f doc.json',
  '  jsonkit get nested.deep.value -f doc.json',
  '',
].join('\n');

const application = [
  'jsonkit',
  'Read and reshape one JSON document.',
  'With no subcommand, jsonkit summarizes the document and its top-level keys.',
  '  jsonkit -f doc.json',
  '  jsonkit get user.name -f doc.json',
  '',
].join('\n');

/** What one invocation of the inspection fixture reports about the installed plugin. */
const inspected = z.object({
  globals: z.array(z.object({ name: z.string(), scope: z.string() })),
  root: z.object({
    children: z.array(
      z.object({ extensions: z.record(z.string(), z.unknown()), name: z.string() }),
    ),
  }),
  version: z.string(),
});

test('jsonkit explains the routed Command and reads no document', () => {
  // The directory holds a document that the invocation never names, and no file is supplied, so
  // A run that reached the action would fail on the absent source rather than exit 0.
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['get', '--explain'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: command,
    });
  });
});

test('jsonkit explains the root when no subcommand is routed', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--explain'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: application,
    });
  });
});

test('jsonkit explains an otherwise invalid invocation instead of rejecting it', () => {
  /**
   * `get` needs its required path, and the named document does not exist. The middleware takes
   * over before the callable check, local parsing, and validation, so neither is ever reached.
   */
  withDocuments({}, (cwd) => {
    expect(invoke(main, ['get', '--explain', '--file', 'missing.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: command,
    });
  });
});

test('the inspected graph carries the plugin option, the extension value, and the version', () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url));
  expect(result.status).toBe(0);
  const graph = inspected.parse(JSON.parse(result.stdout));
  expect(graph.version).toBe(manifest.version);
  expect(graph.globals.map((option) => [option.name, option.scope])).toEqual([
    ['file', 'application'],
    ['explain', 'plugin'],
  ]);
  const get = graph.root.children.find((child) => child.name === 'get');
  expect(get?.extensions).toEqual({
    '@loom/explain/command': {
      details: 'A path is a dot-separated walk from the root of the document.',
      examples: ['jsonkit get name -f doc.json', 'jsonkit get nested.deep.value -f doc.json'],
    },
  });
});
