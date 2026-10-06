import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invokeFromRemovedDirectory } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

/** The source entry, a development build, which only Bun runs directly. */
const source = new URL('../src/main.ts', import.meta.url);

/** The fixture that embeds jsonkit's bundle from a removed working directory. */
const fixture = new URL('fixtures/working-directory.mjs', import.meta.url);

/** The sentence a `WorkingDirectoryError` carries. */
const message =
  'The current working directory cannot be read. Change to a directory that exists and run the command again.';

// An unreadable working directory is an operator failure, so the bundle and the source print the same bytes.
test.each([[['keys', '-f']], [['paths', '--format', 'json', '-f']]])(
  'jsonkit %j from a removed directory prints one line and exits 1 from the bundle and from source',
  (argv) => {
    withDocuments({ 'doc.json': document }, (directory) => {
      const args = [...argv, join(directory, 'doc.json')];
      const expected = { status: 1, stderr: `jsonkit: ${message}\n`, stdout: '' };
      expect(invokeFromRemovedDirectory(main, args)).toEqual(expected);
      expect(invokeFromRemovedDirectory(source, args, { runtime: 'bun' })).toEqual(expected);
    });
  },
);

test('jsonkit.invoke from a removed directory resolves failed with the failure, its form, and the line', () => {
  withDocuments({ 'doc.json': document }, (directory) => {
    const result = invokeFromRemovedDirectory(fixture, ['invoke', join(directory, 'doc.json')]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      cause: 'ENOENT',
      classCode: 'working-directory-unreadable',
      exitCode: 1,
      failure: 'WorkingDirectoryError',
      form: { code: 'working-directory-unreadable', exitCode: 1, hints: [], message },
      messages: `jsonkit: ${message}\n`,
      output: '',
      status: 'failed',
    });
  });
});

test('run() and jsonkit.invoke with a host.cwd override complete from a removed directory', () => {
  withDocuments({ 'doc.json': document }, (directory) => {
    const result = invokeFromRemovedDirectory(fixture, ['overrides', join(directory, 'doc.json')]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    const keys = 'name\ntags\nnested\ncount\nok\nnone\n';
    expect(JSON.parse(result.stdout)).toEqual({
      named: { messages: '', output: keys, status: 'completed' },
      ran: { code: 0, stderr: '', stdout: keys },
    });
  });
});
