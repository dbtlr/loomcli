import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { withDocuments } from './documents.js';

const main = new URL('../dist/main.js', import.meta.url);

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

/** The routed entry's declared failures, parsed at the boundary. */
const declared = z.object({
  command: z.object({
    failures: z.array(z.object({ exitCode: z.number(), meaning: z.string(), name: z.string() })),
  }),
});

test('the hidden Commands that read a document declare invalid-json, and the table names it once', () => {
  const invalidJson = {
    exitCode: 65,
    meaning: 'The document is not valid JSON.',
    name: 'invalid-json',
  };
  for (const name of ['debug', 'paths']) {
    const printed = JSON.parse(invoke(main, [name, '--manifest']).stdout);
    expect(declared.parse(printed).command.failures).toEqual([invalidJson]);
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
])('%j exits with the code its manifest declares for invalid-json', (route, args) => {
  const printed = JSON.parse(invoke(main, [...route, '--manifest']).stdout);
  const declaredCode = declared
    .parse(printed)
    .command.failures.find((failure) => failure.name === 'invalid-json')?.exitCode;
  expect(declaredCode).toBe(65);
  withDocuments({ 'malformed.json': '{"name":' }, (cwd) => {
    expect(invoke(main, args, { cwd }).status).toBe(declaredCode);
  });
});
