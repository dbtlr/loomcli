import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** What the public `checkPluginSettings` answers for one plugin factory's settings. */
function judged(settings: unknown): unknown {
  const result = invoke(new URL('fixtures/plugin-settings.mjs', import.meta.url), [
    JSON.stringify(settings),
  ]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test.each([['a'], [3], [null], [['a']]])(
  'checkPluginSettings rejects settings %j that are not a plain object, at the factory call',
  (settings) => {
    expect(judged(settings)).toEqual({
      correction: 'Supply a settings object, or omit the settings.',
      findings: [
        { args: [settings], call: 'retry', mark: '0', note: 'declared by plugin "@acme/retry"' },
      ],
      rule: '@loomcli/core/not-an-object',
      sentence: 'Plugin "@acme/retry" declares settings that are not an object.',
    });
  },
);

test('checkPluginSettings accepts a plain object whatever keys it holds, a short included', () => {
  expect(judged({})).toBe('returned');
  expect(judged({ short: 'not a letter', tries: 3 })).toBe('returned');
});
