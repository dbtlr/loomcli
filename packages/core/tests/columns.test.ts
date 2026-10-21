// Acceptance plan: see packages/core/tests/style.test.ts.

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/columns.mjs', import.meta.url);

function columns(input: Record<string, unknown>, env?: Record<string, string>) {
  return invoke(fixture, [JSON.stringify(input)], env === undefined ? undefined : { env });
}

const terminal = (stdout: object, stderr: object) => ({
  stderr: { isTTY: true, rows: 24, ...stderr },
  stdin: { isTTY: false },
  stdout: { isTTY: true, rows: 24, ...stdout },
});

/** What the destinations scenario writes for a stdout and a stderr reading and the host facts. */
function written(stdout: string, stderr: string, host: string) {
  return { status: 0, stderr: `stderr:${stderr}\n`, stdout: `stdout:${stdout}\nhost:${host}\n` };
}

test('a view rendered to stdout reads stdout width and one rendered to stderr reads stderr width', () => {
  expect(columns({ env: {}, terminal: terminal({ columns: 100 }, { columns: 60 }) })).toEqual(
    written('100:whole', '60:wrapped', '100,60'),
  );
});

test('a destination that is not a terminal reads no columns when the other one is a terminal', () => {
  expect(
    columns({ env: {}, terminal: terminal({ columns: 100, isTTY: false }, { columns: 60 }) }),
  ).toEqual(written('undefined:whole', '60:wrapped', '100,60'));
});

test('a pipe reads no columns and wrap leaves the text whole, with COLUMNS set', () => {
  expect(columns({}, { COLUMNS: '60' })).toEqual(
    written('undefined:whole', 'undefined:whole', 'undefined,undefined'),
  );
  const piped = terminal({ columns: 100, isTTY: false }, { columns: 100, isTTY: false });
  expect(columns({ env: { COLUMNS: '60' }, terminal: piped })).toEqual(
    written('undefined:whole', 'undefined:whole', '100,100'),
  );
});

test('an invocation by name reads no columns, with COLUMNS set', () => {
  const result = columns({ scenario: 'invoke' }, { COLUMNS: '60' });
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    messages: '',
    output: 'stdout:undefined:whole\nundefined',
    status: 'completed',
  });
});

test.each([
  ['60', 60],
  ['150', 100],
  ['060', 60],
  ['100', 100],
])('COLUMNS=%j narrows a terminal 100 columns wide to %i', (value, expected) => {
  const result = columns({
    env: { COLUMNS: value },
    terminal: terminal({ columns: 100 }, { columns: 100 }),
  });
  expect(result.stdout).toBe(
    `stdout:${expected}:${expected < 100 ? 'wrapped' : 'whole'}\nhost:100,100\n`,
  );
  expect(result.stderr).toBe(`stderr:${expected}:${expected < 100 ? 'wrapped' : 'whole'}\n`);
});

test.each([' 60', '+60', '60 ', '6e1', '0', 'abc', '-5', '60.5', '', '9007199254740992'])(
  'COLUMNS=%j is not a positive integer, so a terminal 100 columns wide reads 100',
  (value) => {
    const result = columns({
      env: { COLUMNS: value },
      terminal: terminal({ columns: 100 }, { columns: 100 }),
    });
    expect(result.stdout).toBe('stdout:100:whole\nhost:100,100\n');
  },
);

test('a terminal that reports no width reads a valid COLUMNS, and no columns without one', () => {
  const unknown = terminal({ columns: undefined }, { columns: undefined });
  expect(columns({ env: { COLUMNS: '60' }, terminal: unknown })).toEqual(
    written('60:wrapped', '60:wrapped', 'undefined,undefined'),
  );
  expect(columns({ env: {}, terminal: unknown })).toEqual(
    written('undefined:whole', 'undefined:whole', 'undefined,undefined'),
  );
});

test('core reads the width for each render call just before it calls the view', () => {
  expect(columns({ argv: ['pieces'], scenario: 'fresh' })).toEqual({
    status: 1,
    stderr: 'message:62:wrapped\ndraw:63:wrapped\nfailure:90:wrapped\n',
    stdout: [
      'render:61:wrapped',
      'head:70:wrapped',
      'a:71:wrapped',
      'b:72:wrapped',
      'tail:73:wrapped',
      '',
    ].join('\n'),
  });
});

test('a result render reads the width at its render', () => {
  expect(columns({ argv: ['result'], scenario: 'fresh' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'result:65:wrapped\n',
  });
});

test('a whole view over a sequence reads the width when it renders, after the source ends', () => {
  expect(columns({ argv: ['whole'], scenario: 'fresh' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'whole:81:wrapped\n',
  });
});

test('the incomplete-result line reads the width when it renders', () => {
  const result = columns({ argv: ['stopped'], scenario: 'fresh' });
  expect(result.stdout).toBe('a:30:wrapped\n');
  expect(result.stderr).toMatch(/^incomplete:44:wrapped\n/u);
});

test.each([
  [['need', '--unknown-option-name']],
  [['need']],
  [['stop']],
  [['crash']],
  [['missing-command-name']],
])(
  "core's default failure text for %j stays one line per sentence on a narrow terminal",
  (argv) => {
    for (const tty of [true, false]) {
      const result = columns({ argv, scenario: 'failure', tty });
      expect(result.status).not.toBe(0);
      expect(result.stderr.trimEnd().length).toBeGreaterThan(20);
      expect(result.stderr.trimEnd()).not.toContain('\n');
    }
  },
);

/*
 * Whether a nowrap frame inside a failure's message resolves, which decides where a first-party
 * failure may mark a path. An InputError's default text prints its message as data, so the frame's
 * delimiters and header show. A FatalError's default text resolves its message, so the frame adds
 * no byte. The same holds on a pipe and on a terminal.
 */
test.each([
  { argv: ['reject'], resolved: false },
  { argv: ['refuse'], resolved: true },
])(
  'a nowrap frame in the default failure text of $argv resolves: $resolved',
  ({ argv, resolved }) => {
    for (const tty of [true, false]) {
      const { stderr } = columns({ argv, scenario: 'failure', tty });
      expect(stderr).toContain('/Users/a/Application Support/x.json');
      expect(/[\uE000-\uE003]/u.test(stderr)).toBe(!resolved);
      expect(stderr.includes('["nowrap"]')).toBe(!resolved);
    }
  },
);

test('a failure view override receives the columns and wraps its own text', () => {
  expect(columns({ argv: ['stop'], override: true, scenario: 'failure' })).toEqual({
    status: 1,
    stderr: '20|The configuration\nfile names a profile\nthat this machine\ndoes not have.\n',
    stdout: '',
  });
});

test('out.draw counts rows against the real stderr width, under COLUMNS and after a resize', () => {
  const result = columns({ scenario: 'draw' });
  expect(JSON.parse(result.stdout)).toEqual({ counted: [1, 2], seen: [60, 40] });
});
