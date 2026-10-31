import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/option-aliases.mjs', import.meta.url);

async function sizes(argv: string[], env: Record<string, string> = {}) {
  return await invokeFixture(fixture, ['run', ...argv], { env });
}

/** The values the root action received, for an invocation that dispatched. */
async function received(argv: string[], env: Record<string, string> = {}): Promise<unknown> {
  const result = await sizes(argv, env);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout).options;
}

/** The values the root action receives when no word supplies one. */
const unset = { color: false, field: [], quiet: true, trace: false };

test.each([
  [['--minimum', '5'], { 'min-bytes': '5' }],
  [['--minimum=5'], { 'min-bytes': '5' }],
  [['--min', '5'], { 'min-bytes': '5' }],
  [['--colour'], { color: true }],
  [['--no-colour'], { color: false }],
  [['--no-silent'], { quiet: false }],
  [['--field', 'a', '--column', 'b', '--field=c'], { field: ['a', 'b', 'c'] }],
  [['--input', 'doc.json'], { file: 'doc.json' }],
  [['--debug'], { trace: true }],
] satisfies [string[], Record<string, unknown>][])(
  'an alias binds the option it belongs to %j',
  async (argv, values) => {
    await expect(received(argv)).resolves.toEqual({ ...unset, ...values });
  },
);

test.each([
  [['--min-bytes', '1', '--minimum', '2'], 'Option "--minimum" can be supplied only once.'],
  [['--minimum'], 'Option "--minimum" requires a value.'],
  [['--colour=yes'], 'Boolean option "--colour" does not accept a value.'],
  [['--silent'], 'Unknown option "--silent".'],
] satisfies [string[], string][])(
  'a fault the parser finds names the typed alias %j',
  async (argv, sentence) => {
    const result = await sizes(argv);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain(`sizes: ${sentence}`);
  },
);

test('a typed alias is the flag, so it wins over the variable its option binds', async () => {
  await expect(received(['--minimum', '1'], { SIZES_MIN_BYTES: '5' })).resolves.toEqual({
    ...unset,
    'min-bytes': '1',
  });
});

test('validation names the option by its own long spelling whichever alias supplied it', async () => {
  await expect(sizes(['--minimum', 'x'])).resolves.toEqual({
    status: 2,
    stderr: 'sizes: Option "--min-bytes": Use a whole number.\n',
    stdout: '',
  });
});

test('inspection reports the declared aliases beside the spellings the declared name derives', async () => {
  const result = await invokeFixture(fixture, ['inspect']);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    globals: [
      { aliases: ['input'], long: '--file', name: 'file', short: null },
      { aliases: ['debug'], long: '--trace', name: 'trace', negative: null, short: null },
    ],
    options: [
      { aliases: ['minimum', 'min'], long: '--min-bytes', name: 'min-bytes', short: null },
      { aliases: ['colour'], long: '--color', name: 'color', negative: '--no-color', short: null },
      { aliases: ['silent'], long: null, name: 'quiet', negative: '--no-quiet', short: null },
      { aliases: ['column'], long: '--field', name: 'field', short: null },
    ],
  });
});

test.each([
  [['--minimum', ''], { kind: 'value', lead: '', option: 'min-bytes', prefix: '' }],
  [['--minimum=4'], { kind: 'value', lead: '--minimum=', option: 'min-bytes', prefix: '4' }],
  [['--input', 'doc.json', 'li'], { kind: 'command', prefix: 'li' }],
] satisfies [string[], Record<string, string>][])(
  'locate reads a typed alias as the parser does %j',
  async (words, position) => {
    const result = await invokeFixture(fixture, ['locate', ...words]);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual(position);
  },
);

test('an alias an option already answers to adds nothing, and the option keeps every spelling', async () => {
  await expect(
    invokeFixture(fixture, ['repeated', '--minimum', '5', '--no-color']),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '[["minimum"],["no-color","colour"]]',
      '{"command":[],"options":{"min-bytes":"5","color":false}}',
      '',
    ].join('\n'),
  });
});
