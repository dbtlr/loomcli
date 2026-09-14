import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test.each(['graph', 'declaration', 'view-registry'])(
  'a validated theme reaches the failure view when %s preparation fails',
  (scenario) => {
    expect(invoke(new URL('fixtures/theme-preparation.mjs', import.meta.url), [scenario])).toEqual({
      status: 1,
      stderr: '\u001b[36minvalid\u001b[39m\n',
      stdout: '',
    });
  },
);
