import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test.each([
  [80, 5],
  [8, 10],
  [40, 5],
  [8, 5],
  [80, 3],
  [80, 1],
])(
  'the default select frame fits %i columns and %i rows including its cursor row',
  (columns, rows) => {
    const result = invoke(new URL('fixtures/viewport.mjs', import.meta.url), [
      String(columns),
      String(rows),
      'Which database should store this workspace’s tasks?',
      'flow',
    ]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ answer: 'choice-3', code: 0 });
    expect(JSON.parse(result.stdout).advanced).toBeLessThan(rows);
  },
);
