/*
 * Acceptance plan for the Boolean grammar of a bound variable
 * (docs/core/input-sources.md#input-sources, Environment values).
 *
 * Every case runs an Application in process on a mock process with one Boolean option of each
 * polarity, each bound to its own variable.
 *
 * - Words. `true`, `yes`, `y`, `on`, and `1` fill true, and `false`, `no`, `n`, `off`, and `0` fill
 *   false, in any case and under every polarity.
 * - Outside the grammar. Any other value, a padded word or a prefix of one included, is a usage
 *   failure naming the variable whose issue lists the grammar, and the action never runs.
 */
import { Application } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** The values the action read, or none when it never ran. */
const seen: Record<string, boolean>[] = [];

function application() {
  return new Application('app')
    .option('total', { description: 'The total option.', env: 'APP_TOTAL', type: 'boolean' })
    .option('quiet', {
      description: 'The quiet option.',
      env: 'APP_QUIET',
      polarity: 'negative',
      type: 'boolean',
    })
    .option('color', {
      description: 'The color option.',
      env: 'APP_COLOR',
      polarity: 'both',
      type: 'boolean',
    })
    .action(({ options }) => {
      seen.push({ color: options.color, quiet: options.quiet, total: options.total });
    });
}

/** One run with every option's variable holding `value`. */
async function run(value: string) {
  seen.length = 0;
  const mock = mockProcess({ env: { APP_COLOR: value, APP_QUIET: value, APP_TOTAL: value } });
  const status = await application().run({ process: mock });
  return { seen: [...seen], status, stderr: mock.stderr.text };
}

test.each([
  ['true', true],
  ['YES', true],
  ['y', true],
  ['On', true],
  ['1', true],
  ['False', false],
  ['no', false],
  ['N', false],
  ['OFF', false],
  ['0', false],
])('%s fills a Boolean option with %s under every polarity', async (value, expected) => {
  await expect(run(value)).resolves.toEqual({
    seen: [{ color: expected, quiet: expected, total: expected }],
    status: 0,
    stderr: '',
  });
});

test.each(['maybe', ' yes', 'on ', 'ye', 't', 'f', '2'])(
  '%j is outside the grammar and fails naming each variable',
  async (value) => {
    const issue = 'Use true, false, yes, no, y, n, on, off, 1, or 0.';
    const result = await run(value);
    expect(result).toMatchObject({ seen: [], status: 2 });
    expect(result.stderr).toContain(`Option "--total" (from APP_TOTAL): ${issue}\n`);
    expect(result.stderr).toContain(`Option "--no-quiet" (from APP_QUIET): ${issue}\n`);
    expect(result.stderr).toContain(`Option "--color" (from APP_COLOR): ${issue}\n`);
  },
);
