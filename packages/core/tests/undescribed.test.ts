import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/undescribed.mjs', import.meta.url);

test('a development run and app.invoke() run a graph with an undescribed Command, option, and argument, and check() reports no fault', () => {
  const result = invoke(fixture, []);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  expect(result.stdout.endsWith('{"checked":0,"code":0,"invoked":"completed"}\n')).toBe(true);
});
