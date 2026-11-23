import { expect, test } from 'vite-plus/test';

import { isFailureCode } from '../src/index.js';

test.each(['path-not-found', 'http-503', 'fatal'])('isFailureCode accepts %j', (code) => {
  expect(isFailureCode(code)).toBe(true);
});

test.each(['Path_Not_Found', '', '-x', 'a--b', 'path not found', 'x-'])(
  'isFailureCode rejects %j',
  (code) => {
    expect(isFailureCode(code)).toBe(false);
  },
);
