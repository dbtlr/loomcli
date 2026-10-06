import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

/** The source entry, a development build, which only Bun runs directly. */
const source = new URL('../src/main.ts', import.meta.url);

test('the source packet reads development', () => {
  expect(JSON.parse(readFileSync(new URL('../loom.packet.json', import.meta.url), 'utf8'))).toEqual(
    { build: 'development' },
  );
});

// A usage error is an operator failure, so the bundle and the source print the same bytes.
test.each([
  [
    ['select', '--field', '', '-f', 'doc.json'],
    'jsonkit: Option "--field" at 0: Expected a nonempty value.\nRun "jsonkit select --help" to see the usage.\n',
  ],
  [
    ['get', '-f', 'doc.json'],
    'jsonkit: Argument "path" requires a value. Supply a value for "path".\nRun "jsonkit get --help" to see the usage.\n',
  ],
  [
    ['typo', '-f', 'doc.json'],
    'jsonkit: Unknown command "typo". Use one of: doctor, completion, mcp, get, keys, select.\nRun "jsonkit --help" to see the usage.\n',
  ],
  [
    ['gte', '-f', 'doc.json'],
    'jsonkit: Unknown command "gte". Did you mean "get"?\nRun "jsonkit --help" to see the usage.\n',
  ],
])('jsonkit %j prints the same usage error from the bundle and from source', (argv, stderr) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    const expected = { status: 2, stderr, stdout: '' };
    expect(invoke(main, argv, { cwd })).toEqual(expected);
    expect(invoke(source, argv, { cwd, runtime: 'bun' })).toEqual(expected);
  });
});
