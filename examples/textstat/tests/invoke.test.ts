import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** What one by-name run resolved, as the fixture prints it. */
interface Failed {
  readonly exitCode: number;
  readonly form: unknown;
  readonly messages: string;
  readonly output: string;
  readonly status: string;
}

const form = {
  code: 'invalid-input',
  exitCode: 2,
  hints: [],
  message: 'Option "metric": Expected one of: bytes, words, lines.',
};

test('textstat.invoke() with an invalid metric carries the form on its outcome, and its messages keep the text even under the json view', () => {
  const result = invoke(new URL('fixtures/invoke.mjs', import.meta.url));
  expect(result.stderr).toBe('');
  const { json, plain }: { json: Failed; plain: Failed } = JSON.parse(result.stdout);
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
