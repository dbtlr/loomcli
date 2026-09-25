import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test.each(['root', 'hook'])(
  'a validated theme reaches the failure view when the %s build fails',
  (scenario) => {
    expect(invoke(new URL('fixtures/theme-preparation.mjs', import.meta.url), [scenario])).toEqual({
      status: 1,
      stderr: '\u001b[36minvalid\u001b[39m\n',
      stdout: '',
    });
  },
);
