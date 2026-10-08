import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

/** The source entry, a source run, which only Bun runs directly. */
const source = new URL('../src/main.ts', import.meta.url);

/** The fixture that prints every fault `check()` returns for jsonkit's declarations. */
const checked = new URL('fixtures/check.mjs', import.meta.url);

test('jsonkit declares no fault check() returns, from the bundle and from source', () => {
  const clean = { status: 0, stderr: '', stdout: '[]\n' };
  expect(invoke(checked, ['bundle'])).toEqual(clean);
  expect(invoke(checked, ['source'], { runtime: 'bun' })).toEqual(clean);
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
