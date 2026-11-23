/*
 * Acceptance plan for log lines (docs/core/logging.md#at--v).
 *
 * The log lines are proven when public APIs alone produce these results, through a fixture
 * Application that marks its own `-v, --verbose` and `-q, --quiet` and logs through message
 * templates:
 *
 * - The verbosity. At -1 and 0 no log event shows; at 1 every event at debug and above shows on
 *   stderr, in call order beside the run's own lines; at 2 trace shows too. The bytes are the same
 *   with an `onLog` hook installed and without one.
 * - Templates. `{name}` fills from that field, a field the message does not place trails as
 *   `name=value`, a string that holds whitespace, a double quote, or an equals sign, or is empty,
 *   trails as JSON, any other value trails as JSON, `{{` writes one brace, and a placeholder whose
 *   field is absent is written as it stands. Every value is escaped. The hook reads the message as
 *   written.
 * - Failures. A failure event never shows as a log line, while the hook still hears it.
 * - Reading. With no hook and a verbosity that shows nothing, a call reads none of its fields.
 * - Nested runs. Under an action's `invoke`, lines follow the outermost run's verbosity and land on
 *   its stderr; under `app.invoke`, they land in `messages` when its values ask for them.
 * - The look. On a terminal under the Loom theme, a debug line's glyph and trailing fields are
 *   dim, and a trace line fades whole, as the reference shows.
 */
import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/log-lines.mjs', import.meta.url);

/** A shell environment with no color variable and a terminal type that supports color. */
const plain = { COLORTERM: undefined, FORCE_COLOR: undefined, NO_COLOR: undefined, TERM: 'xterm' };

async function notes(
  variant: string,
  terminal: 'tty' | 'pipe' | 'invoke',
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
) {
  return await invokeFixture(fixture, [variant, terminal, ...argv], { env: { ...plain, ...env } });
}

const traceLine = '  ┆ Looked in /etc.\n';
const debugLines = [
  '› Read /srv/a b.json in 12 ms. count=3 extra="x y"\n',
  '› Indexed {sessions} for claude {missing}. when=now\n',
  `${String.raw`› Skipped a line. line=a\u0007b note=""`}\n`,
  '› Gave up. cause={"code":"E"} tries=[1,2]\n',
].join('');
const warned = '⚠ warned\n';

test.each([
  [-1, ['-q'], warned],
  [0, [], warned],
  [1, ['-v'], `${debugLines}${warned}`],
  [2, ['-vv'], `${traceLine}${debugLines}${warned}`],
])(
  'at verbosity %i, with and without an onLog hook, stderr reads its log lines',
  async (_verbosity, flags, stderr) => {
    const bare = await notes('plain', 'pipe', [...flags, 'index']);
    expect(bare).toEqual({ status: 0, stderr, stdout: '' });
    const hooked = await notes('hooked', 'pipe', [...flags, 'index']);
    expect(hooked.stderr).toBe(stderr);
    expect(hooked.status).toBe(0);
  },
);

test('an onLog hook reads each message as written, its template unfilled', async () => {
  const { stdout } = await notes('hooked', 'pipe', ['index']);
  expect(stdout).toBe(
    `heard ${JSON.stringify([
      'trace Looked in {dir}.',
      'debug Read {file} in {ms} ms.',
      'info Indexed {{sessions}} for {harness} {missing}.',
      'warn Skipped a line.',
      'error Gave up.',
    ])}\n`,
  );
});

test.each([['plain'], ['hooked']])(
  'a failure event never shows as a log line (%s)',
  async (variant) => {
    const result = await notes(variant, 'pipe', ['-vv', 'fail']);
    expect(result.status).toBe(1);
    expect(result.stderr.split('\n').filter((line) => line.startsWith('›'))).toEqual([
      '› Before fail.',
    ]);
    expect(result.stderr).not.toContain('› It failed.');
  },
);

test('the hook still hears the failure event', async () => {
  const { stdout } = await notes('hooked', 'pipe', ['fail']);
  expect(stdout).toBe(`heard ${JSON.stringify(['debug Before {step}.', 'error It failed.'])}\n`);
});

test.each([
  ['plain', [], 'reads 0\n'],
  ['plain', ['-v'], 'reads 1\n'],
  ['hooked', [], 'reads 1\n'],
])('%s %j reads the fields only when something takes the event', async (variant, flags, reads) => {
  const { stdout } = await notes(variant, 'pipe', [...flags, 'counted']);
  expect(stdout.startsWith(reads)).toBe(true);
});

test("under an action's invoke the lines follow the outermost run", async () => {
  const shown = await notes('plain', 'pipe', ['-v', 'nested']);
  expect(shown).toEqual({
    status: 0,
    stderr: debugLines,
    stdout: `${JSON.stringify(warned)}\n`,
  });
  const hidden = await notes('plain', 'pipe', ['nested']);
  expect(hidden.stderr).toBe('');
});

test('under app.invoke the lines land in messages when its values ask for them', async () => {
  const asked = await notes('plain', 'invoke', [JSON.stringify({ verbose: 2 })]);
  expect(JSON.parse(asked.stdout)).toEqual({
    messages: `${traceLine}${debugLines}${warned}`,
    status: 'completed',
  });
  const unasked = await notes('plain', 'invoke', ['{}']);
  expect(JSON.parse(unasked.stdout)).toEqual({ messages: warned, status: 'completed' });
});

/** One SGR sequence. */
const escape = String.fromCodePoint(27);

test('on a terminal a debug line dims its glyph and fields, and a trace line fades whole', async () => {
  const { stderr } = await notes('themed', 'tty', ['-vv', 'index']);
  const [trace, debug] = stderr.split('\n');
  expect(trace).toBe(
    `  ${escape}[90;2m┆${escape}[39;22m ${escape}[90;2mLooked in /etc.${escape}[39;22m`,
  );
  expect(debug).toBe(
    `${escape}[90m›${escape}[39m Read /srv/a b.json in 12 ms. ${escape}[90mcount=3 extra="x y"${escape}[39m`,
  );
});

test('an error field shows only its escaped name and message, placed or trailing', async () => {
  const result = await notes('plain', 'pipe', ['-v', 'errors']);
  expect(result).toEqual({
    status: 0,
    stderr: `${String.raw`› Placed Error: bad\u000a[red]value.`}\n${String.raw`› Trailing. error=Error: bad\u000a[red]value`}\n`,
    stdout: '',
  });
});

test('the hook keeps the full error copy while the screen omits stack and cause', async () => {
  const result = await notes('errors', 'pipe', ['-v', 'errors']);
  const heard = JSON.parse(result.stdout.slice('heard '.length));
  expect(heard[0].error).toMatchObject({
    cause: { message: 'hidden cause', name: 'Error' },
    message: 'bad\n[red]value',
    name: 'Error',
    stack: 'hidden stack',
  });
  expect(result.stderr).not.toContain('hidden');
});

test('a placed sentence wraps under the gutter at a narrow terminal width', async () => {
  const result = await notes('narrow', 'tty', ['-v', 'sentence']);
  expect(result.stderr).toBe('› Ignored port: Choose a\n  number between one and\n  ten.\n');
});
