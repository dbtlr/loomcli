import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { textstat } from '../src/application.js';

const form = {
  code: 'invalid-input',
  exitCode: 2,
  hints: [],
  message: 'Option "metric": Expected one of: bytes, words, lines.',
};

/** `textstat --metric nope one.txt`, run by name, with no view and with the json view. */
async function failures() {
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-invoke-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'hello\n');
    const values = { args: { files: ['one.txt'] }, options: { metric: 'nope' } };
    const plainMock = mockProcess({ cwd: directory });
    const plain = await textstat.invoke([], values, { process: plainMock });
    const jsonMock = mockProcess({ cwd: directory });
    const json = await textstat.invoke([], values, { process: jsonMock, view: 'json' });
    // An invocation by name writes nothing to the process and sets no exit code.
    for (const mock of [plainMock, jsonMock]) {
      expect(mock.stdout.text).toBe('');
      expect(mock.stderr.text).toBe('');
      expect(mock.exitCode).toBeUndefined();
    }
    return { json, plain };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('textstat.invoke() with an invalid metric carries the form on its outcome, and its messages keep the text even under the json view', async () => {
  const { json, plain } = await failures();
  const failed = {
    exitCode: 2,
    form,
    messages: 'textstat: Option "metric": Expected one of: bytes, words, lines.\n',
    output: '',
    status: 'failed',
  };
  expect(plain).toMatchObject(failed);
  expect(json).toMatchObject(failed);
});
