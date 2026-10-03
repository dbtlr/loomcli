import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** What the public `checkShortSetting` answers for one plugin factory's settings. */
function judged(settings: unknown): unknown {
  const result = invoke(new URL('fixtures/short-setting.mjs', import.meta.url), [
    JSON.stringify(settings),
  ]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

test("checkShortSetting judges a plugin factory's short spelling by every option's short-alias rule, at the factory's call", () => {
  expect(judged({ short: 'at', tries: 3 })).toEqual({
    findings: [
      {
        args: [{ short: 'at', tries: 3 }],
        call: 'retry',
        mark: '0.short',
        note: 'declared by plugin "@acme/retry"',
      },
    ],
    rule: '@loomcli/core/short-alias',
    sentence: 'Option "attempts" declares a short alias that is not one ASCII letter.',
  });
});

test('checkShortSetting rejects settings that are not a plain object under not-an-object', () => {
  expect(judged('a')).toEqual({
    findings: [{ args: ['a'], call: 'retry', mark: '0', note: 'declared by plugin "@acme/retry"' }],
    rule: '@loomcli/core/not-an-object',
    sentence: 'Plugin "@acme/retry" declares settings that are not an object.',
  });
});

test('checkShortSetting accepts one ASCII letter, no short, and other keys beside it', () => {
  expect(judged({ short: 'a' })).toBe('returned');
  expect(judged({ tries: 3 })).toBe('returned');
});
