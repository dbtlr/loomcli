import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);

/** A pinned document, checked by hand against the manifest contract's rules. */
function pinned(name: string): string {
  return readFileSync(new URL(`fixtures/manifest/${name}.json`, import.meta.url), 'utf8');
}

test('jsonkit --manifest prints the whole application, omitting the hidden paths and debug', () => {
  expect(invoke(main, ['--manifest'])).toEqual({ status: 0, stderr: '', stdout: pinned('root') });
});

test('jsonkit get --manifest prints the get slice while its required path is missing', () => {
  expect(invoke(main, ['get', '--manifest'])).toEqual({
    status: 0,
    stderr: '',
    stdout: pinned('get'),
  });
});

test('jsonkit --help --manifest prints help and --version --manifest the version, by installation order', () => {
  expect(invoke(main, ['--help', '--manifest']).stdout).toMatch(/^jsonkit · /u);
  expect(invoke(main, ['--version', '--manifest']).stdout).toBe('jsonkit v0.0.0\n');
});

/** The routed entry's name, description, and deprecation, parsed at the boundary. */
const routed = z.object({
  command: z.object({
    deprecated: z.string().nullable(),
    description: z.string().nullable(),
    name: z.string().nullable(),
  }),
});

test('jsonkit fetch --manifest carries the deprecation, and debug --manifest prints the hidden slice', () => {
  const fetch = routed.parse(JSON.parse(invoke(main, ['fetch', '--manifest']).stdout));
  expect(fetch.command).toEqual({
    deprecated: 'Use get instead.',
    description: 'Read one value at a path.',
    name: 'fetch',
  });
  const debug = routed.parse(JSON.parse(invoke(main, ['debug', '--manifest']).stdout));
  expect(debug.command).toEqual({
    deprecated: null,
    description: 'Dump the parsed document.',
    name: 'debug',
  });
  expect(pinned('root')).not.toContain('"name": "debug"');
});
