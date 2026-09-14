import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function styled(scenario: string) {
  return invoke(new URL('fixtures/style.mjs', import.meta.url), [scenario]);
}

test('each run captures fresh capability facts and supplies one immutable view context', () => {
  expect(styled('fresh')).toEqual({ status: 0, stderr: '', stdout: '\u001b[31mX\u001b[39mX' });
});

test('styles compose as ordinary strings and restore the enclosing foreground', () => {
  expect(styled('nesting')).toEqual({
    status: 0,
    stderr: '',
    stdout: '\u001b[31mA\u001b[34mB\u001b[31mC\u001b[39m\n',
  });
});

test('one policy resolves stdout and stderr separately, with a prefix-free print lane', () => {
  expect(styled('destinations')).toEqual({
    status: 0,
    stderr: 'i \u001b[31mready\u001b[39m\n  next\n',
    stdout: 'plain\n',
  });
});

test('a theme contributes concrete chains and contextual names without changing glyph identity', () => {
  expect(styled('theme')).toEqual({
    status: 0,
    stderr: '\u001b[32;1mi\u001b[39;22m ready\n',
    stdout: '\u001b[36mcustom\u001b[39m\n',
  });
});

function resolve(text: string, options: Record<string, unknown> = {}) {
  return invoke(new URL('fixtures/resolve-style.mjs', import.meta.url), [
    JSON.stringify({ text, ...options }),
  ]);
}

const redSpan = (body: string) => `\uE000["style",[["foreground","red"]]]\uE001${body}\uE002`;

test('embedded ANSI resets restore enclosing Loom attributes and close at the call boundary', () => {
  expect(resolve(redSpan('A\u001b[34mB\u001b[39mC'), { rendering: { color: 'always' } })).toEqual({
    status: 0,
    stderr: '',
    stdout: '\u001b[31mA\u001b[34mB\u001b[31mC\u001b[39m',
  });
});

const bold = (body: string) => `\uE000["style",[["modifier","bold"]]]\uE001${body}\uE002`;

test('preserved unmodeled SGR closes at each output boundary', () => {
  const rendering = { color: 'always', terminalControls: 'preserve' };
  expect(resolve('', { rendering, texts: ['\u001b[5mblink', 'plain'] }).stdout).toBe(
    '\u001b[5mblink\u001b[0mplain',
  );
  expect(resolve('\u009b5mX', { rendering }).stdout).toBe('\u001b[5mX\u001b[0m');
  expect(resolve(redSpan('\u001b[5mX'), { rendering }).stdout).toBe(
    '\u001b[31m\u001b[5mX\u001b[39m\u001b[0m',
  );
});

test('closing a Loom frame restores outer raw and Loom attributes together', () => {
  expect(
    resolve(redSpan(`A${bold('\u001b[34mB')}C`), {
      rendering: { color: 'always', modifiers: 'always' },
    }).stdout,
  ).toBe('\u001b[31mA\u001b[34;1mB\u001b[31;22mC\u001b[39m');
  expect(resolve(`\u001b[34mA${redSpan('B')}C`, { rendering: { color: 'always' } }).stdout).toBe(
    '\u001b[34mA\u001b[31mB\u001b[34mC\u001b[39m',
  );
});

test('ANSI recognition spans removed Loom frames before policy filters a command', () => {
  expect(
    resolve(`\u001b[3${redSpan('1mX')}`, {
      rendering: { color: 'never', modifiers: 'never', terminalControls: 'preserve' },
    }),
  ).toEqual({
    status: 0,
    stderr: '',
    stdout: 'X',
  });
  expect(
    resolve(`${redSpan('\u001b]0;hidden')}\u0007X`, { rendering: { color: 'always' } }),
  ).toEqual({
    status: 0,
    stderr: '',
    stdout: 'X',
  });
});

const padded = (body: string, columns: number, align = 'left') =>
  `\uE000["pad",${columns},"${align}"]\uE001${body}\uE002`;

test('interrupted ANSI prefixes cannot assemble forbidden commands', () => {
  const rendering = { color: 'never', modifiers: 'never', terminalControls: 'preserve' };
  expect(resolve('', { rendering, texts: ['\u001b[3\u001b', '1mX'] }).stdout).toBe('1mX');
  expect(resolve('\u001b\u001b[31m[31mX', { rendering }).stdout).toBe('[31mX');
});

test('padding preserves composed graphemes, CRLF, and terminal empty lines', () => {
  expect(resolve(`${padded('👩', 0)}‍💻`, { measure: true }).stdout).toBe('2');
  expect(resolve(padded(`👩${padded('‍💻', 0)}`, 3)).stdout).toBe('👩‍💻 ');
  expect(resolve(padded(`\r${padded('\n', 0)}`, 5)).stdout).toBe('     \r\n');
  expect(resolve(padded(`cat\n${padded('', 0)}`, 5)).stdout).toBe('cat  \n');
  expect(resolve(`\r${padded('\n', 1)}`).stdout).toBe(' \r\n');
  expect(resolve(padded('\u0600', 2)).stdout).toBe('\u0600  ');
});

test('zero-width terminal envelopes after a newline do not create a padded extra line', () => {
  const linkOpen = '\u001b]8;;https://example.com\u001b\\';
  const linkClose = '\u001b]8;;\u001b\\';
  expect(
    resolve(padded(`${linkOpen}cat\n${linkClose}`, 5), { rendering: { hyperlinks: 'always' } })
      .stdout,
  ).toBe(`${linkOpen}cat  \n${linkClose}`);
  expect(
    resolve(padded('cat\n\u001b[0K', 5), { rendering: { terminalControls: 'preserve' } }).stdout,
  ).toBe('cat  \n\u001b[0K');
});

test('padding spaces inherit the surrounding raw ANSI attributes', () => {
  expect(resolve(`\u001b[34m${padded('X', 3)}`, { rendering: { color: 'always' } }).stdout).toBe(
    '\u001b[34mX  \u001b[39m',
  );
});

test('empty styled padding cannot change the scope of following text', () => {
  const blue = '\uE000["style",[["foreground","blue"]]]\uE001X\uE002';
  expect(resolve(`${redSpan(padded('', 3))}X`, { rendering: { color: 'always' } }).stdout).toBe(
    '\u001b[31m   \u001b[39mX',
  );
  expect(
    resolve(`${redSpan(padded('', 3))}${blue}`, { rendering: { color: 'always' } }).stdout,
  ).toBe('\u001b[31m   \u001b[34mX\u001b[39m');
});

test('large empty boundaries and deep unchanged multiline padding stay bounded', () => {
  expect(resolve(padded('', 0), { repeat: 100_000 })).toEqual({
    status: 0,
    stderr: '',
    stdout: '',
  });
  expect(
    resolve('X\n', { measure: true, nest: { depth: 32_000, width: 0 }, repeat: 32_000 }),
  ).toEqual({ status: 0, stderr: '', stdout: '1' });
  expect(
    resolve('X\n', { measure: true, nest: { depth: 10_000, width: 1 }, repeat: 10_000 }),
  ).toEqual({ status: 0, stderr: '', stdout: '1' });
  expect(resolve('\uE000', { measure: true, repeat: 100_000 })).toEqual({
    status: 0,
    stderr: '',
    stdout: '100000',
  });
});

test.each([
  ['reset', '39;49;22', '31;44;1'],
  ['resetForeground', '39', '31'],
  ['resetBackground', '49', '44'],
])('scoped %s clears only the requested inherited attributes', (reset, clearing, restoring) => {
  const inside = `\uE000["style",[["${reset}"]]]\uE001B\uE002`;
  const text = `\uE000["style",[["foreground","red"],["background","blue"],["modifier","bold"]]]\uE001A${inside}C\uE002`;
  expect(resolve(text, { rendering: { color: 'always', modifiers: 'always' } }).stdout).toBe(
    `\u001b[31;44;1mA\u001b[${clearing}mB\u001b[${restoring}mC\u001b[39;49;22m`,
  );
});

test('every exported glyph matches the pinned main and compatibility catalog', () => {
  const catalog = readFileSync(new URL('../../../docs/glyphs.md', import.meta.url), 'utf8');
  const rows = [
    ...catalog.matchAll(/^\| `[^`]+` \| `(?<main>[^`]+)` \| `(?<compat>[^`]+)` \|$/gmu),
  ];
  expect(rows.length).toBeGreaterThan(70);
  const main = rows.map((row) => row.groups?.main).join('\n');
  const compat = rows.map((row) => row.groups?.compat).join('\n');
  expect(resolve('', { env: { NO_COLOR: '1' }, glyph: 'all' }).stdout).toBe(main);
  expect(resolve('', { env: { FORCE_COLOR: '1', TERM: 'linux' }, glyph: 'all' }).stdout).toBe(
    compat,
  );
});

test.each([
  [{}, 'i'],
  [{ WT_SESSION: 'yes' }, 'ℹ'],
  [{ CI: '1' }, 'ℹ'],
  [{ ConEmuTask: '{cmd::Cmder}' }, 'ℹ'],
  [{ TERMINUS_SUBLIME: '1' }, 'ℹ'],
  [{ TERM_PROGRAM: 'Terminus-Sublime' }, 'ℹ'],
  [{ TERM_PROGRAM: 'vscode' }, 'ℹ'],
  [{ TERM: 'xterm-256color' }, 'ℹ'],
  [{ TERM: 'alacritty' }, 'ℹ'],
  [{ TERMINAL_EMULATOR: 'JetBrains-JediTerm' }, 'ℹ'],
  [{ wt_session: 'yes' }, 'i'],
])('Windows glyph selection uses captured case-sensitive facts %j', (env, expected) => {
  expect(resolve('', { env, glyph: 'info', platform: 'win32' }).stdout).toBe(expected);
});

test.each([null, 'always', [], 12])(
  'invalid Application rendering policy %j is rejected',
  (rendering) => {
    const result = resolve('X', { rendering });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('rendering');
  },
);

test.each(['prototype', 'caller', 'arguments', 'valueOf', 'toLocaleString'])(
  'reserved theme name %s is a declaration error',
  (name) => {
    const result = resolve('X', { themes: [{ [name]: ['red'] }] });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('built-in style member');
  },
);

test('padding resolves compatibility glyphs and measures Unicode columns, tabs, and lines', () => {
  const radio = '\uE000["glyph","radioOn"]\uE001\uE002';
  expect(resolve(padded(padded(radio, 5), 8, 'center'), { env: { TERM: 'linux' } })).toEqual({
    status: 0,
    stderr: '',
    stdout: ' (*)    ',
  });
  expect(resolve(padded('a\tb\r\n古\n\n', 11, 'right'))).toEqual({
    status: 0,
    stderr: '',
    stdout: '  a       b\r\n         古\n           \n',
  });
  expect(resolve('é👨‍👩‍👧‍👦🇺🇸\n古\ta', { measure: true })).toEqual({
    status: 0,
    stderr: '',
    stdout: '9',
  });
});

const namedColors = [
  ['black', 30],
  ['red', 31],
  ['green', 32],
  ['yellow', 33],
  ['blue', 34],
  ['magenta', 35],
  ['cyan', 36],
  ['white', 37],
  ['brightBlack', 90],
  ['brightRed', 91],
  ['brightGreen', 92],
  ['brightYellow', 93],
  ['brightBlue', 94],
  ['brightMagenta', 95],
  ['brightCyan', 96],
  ['brightWhite', 97],
] as const;

test.each(namedColors)(
  'the %s foreground and background preserve their terminal palette identity',
  (name, code) => {
    expect(
      resolve('X', {
        chain: [name],
        env: { COLORTERM: 'truecolor' },
        rendering: { color: 'always' },
      }).stdout,
    ).toBe(`\u001b[${code}mX\u001b[39m`);
    const background = `bg${name.charAt(0).toUpperCase()}${name.slice(1)}`;
    expect(resolve('X', { chain: [background], rendering: { color: 'always' } }).stdout).toBe(
      `\u001b[${code + 10}mX\u001b[49m`,
    );
  },
);

test.each([
  ['bold', 1, 22],
  ['faint', 2, 22],
  ['italic', 3, 23],
  ['underline', 4, 24],
  ['inverse', 7, 27],
  ['hidden', 8, 28],
  ['strikethrough', 9, 29],
  ['overline', 53, 55],
] as const)(
  '%s has an independent modifier policy and closes at the call boundary',
  (name, on, off) => {
    expect(
      resolve('X', { chain: [name], rendering: { color: 'never', modifiers: 'always' } }).stdout,
    ).toBe(`\u001b[${on}mX\u001b[${off}m`);
    expect(resolve(`\u001b[${on}mX`, { rendering: { modifiers: 'never' }, tty: true }).stdout).toBe(
      'X',
    );
  },
);

test('color helpers normalize input and degrade to the nearest indexed color', () => {
  expect(
    resolve('X', {
      chain: [['hex', '#F00']],
      env: { COLORTERM: 'truecolor' },
      rendering: { color: 'always' },
    }).stdout,
  ).toBe('\u001b[38;2;255;0;0mX\u001b[39m');
  expect(
    resolve('X', {
      chain: [['rgb', 255, 0, 0]],
      env: { TERM: 'xterm-256color' },
      rendering: { color: 'always' },
    }).stdout,
  ).toBe('\u001b[91mX\u001b[39m');
  expect(resolve('X', { chain: [['ansi256', 196]], rendering: { color: 'always' } }).stdout).toBe(
    '\u001b[91mX\u001b[39m',
  );
  expect(
    resolve('X', {
      chain: [['bgHex', '#123']],
      env: { COLORTERM: '24bit' },
      rendering: { color: 'always' },
    }).stdout,
  ).toBe('\u001b[48;2;17;34;51mX\u001b[49m');
  expect(
    resolve('X', {
      chain: [['bgAnsi256', 196]],
      env: { TERM_PROGRAM: 'Apple_Terminal' },
      rendering: { color: 'always' },
    }).stdout,
  ).toBe('\u001b[48;5;196mX\u001b[49m');
});

test.each(
  [
    [['rgb', 256, 0, 0]],
    [['rgb', 1.5, 0, 0]],
    [['rgb', '1', 0, 0]],
    [['hex', '#1234']],
    [['ansi256', -1]],
    [['bgRgb', 0, 0, 999]],
  ].map((chain) => ({ chain })),
)('invalid color helper input is rejected before rendering: %j', ({ chain }) => {
  const result = resolve('X', { chain });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/Color channels|Hex colors/u);
});

test.each([
  [{}, false, false, false],
  [{}, true, true, true],
  [{ TERM: 'dumb' }, true, false, false],
  [{ NO_COLOR: '0' }, true, false, true],
  [{ NO_COLOR: '' }, true, true, true],
  [{ FORCE_COLOR: '0' }, false, true, true],
  [{ FORCE_COLOR: '3', NO_COLOR: '1' }, false, true, true],
  [{ FORCE_COLOR: '' }, false, false, false],
] as const)(
  'automatic color and modifier policy uses captured facts %j, tty %s',
  (env, tty, color, modifier) => {
    const result = resolve('X', { chain: ['red', 'bold'], env, tty });
    const starts = [color ? 31 : undefined, modifier ? 1 : undefined].filter(
      (value) => value !== undefined,
    );
    const ends = [color ? 39 : undefined, modifier ? 22 : undefined].filter(
      (value) => value !== undefined,
    );
    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout: `${starts.length ? `\u001b[${starts.join(';')}m` : ''}X${ends.length ? `\u001b[${ends.join(';')}m` : ''}`,
    });
  },
);

test('invocation policy overrides supplied fields and explicit auto restores detection', () => {
  expect(
    resolve('X', {
      chain: ['red', 'bold'],
      rendering: { color: 'always', modifiers: 'always' },
      runRendering: { color: 'auto' },
    }).stdout,
  ).toBe('\u001b[1mX\u001b[22m');
  expect(
    resolve('X', {
      chain: ['red', 'bold'],
      env: { NO_COLOR: '1' },
      rendering: { color: 'never', modifiers: 'always' },
      runRendering: { color: 'always' },
    }).stdout,
  ).toBe('\u001b[31;1mX\u001b[39;22m');
});

const link = '\u001b]8;;https://example.test\u001b\\label\u001b]8;;\u001b\\';

test('hyperlinks and general terminal controls have independent policies', () => {
  expect(resolve(`${link}\u001b[2J\u0007`).stdout).toBe('label');
  expect(resolve(`${link}\u001b[2J\u0007`, { rendering: { hyperlinks: 'always' } }).stdout).toBe(
    link,
  );
  expect(
    resolve(`${link}\u001b[2J\u0007`, { rendering: { terminalControls: 'preserve' } }).stdout,
  ).toBe('label\u001b[2J\u0007');
  expect(resolve('\u001b]8;;https://example.test\u001b\\X', { tty: true }).stdout).toBe(
    '\u001b]8;;https://example.test\u001b\\X\u001b]8;;\u001b\\',
  );
  expect(resolve(link, { measure: true, tty: true }).stdout).toBe('5');
});

test.each(['\u001b[3', '\u001b', '\u001b]0;hidden', '\u001bPpayload', '\u009d0;hidden'])(
  'incomplete ANSI is discarded even when controls are preserved: %j',
  (raw) => {
    expect(
      resolve('', { rendering: { terminalControls: 'preserve' }, texts: [raw, '1mX'] }).stdout,
    ).toBe('1mX');
  },
);

test.each([
  '\u001b]0;a\u001b[31mb\u0007',
  '\u001bPpayload\u001b\\',
  '\u001b_payload\u001b\\',
  '\u009d0;hidden\u009c',
])('control payload is opaque and completely filtered: %j', (raw) => {
  expect(resolve(`${raw}X`).stdout).toBe('X');
  expect(resolve(`${raw}X`, { measure: true }).stdout).toBe('1');
});

test('literal escaping decodes once while malformed frames retain their data', () => {
  const literal = '\uE000\uE001\uE002\uE003';
  expect(resolve(literal, { escapeTimes: 1 }).stdout).toBe(literal);
  expect(resolve(literal, { escapeTimes: 2 }).stdout).toBe(
    '\uE003E000\uE003E001\uE003E002\uE003E003',
  );
  expect(resolve(redSpan('X'), { escapeTimes: 1 }).stdout).toBe(redSpan('X'));
  for (const input of [
    '\uE000["glyph","tick"]\uE001KEEP\uE002',
    '\uE000["glyph","missing"]\uE001\uE002',
    '\uE000["style",[["token","missing"]]]\uE001X\uE002',
    '\uE000{bad\uE000json\uE001X\uE002',
    '\uE000truncated',
    '\uE003E004',
    '\uE001\uE002',
  ]) {
    expect(resolve(input).stdout).toBe(input);
    expect(resolve(input, { measure: true }).stdout).toBe(String(input.length));
  }
  expect(
    resolve('\uE000["style",[["foreground","red"]]]\uE001X', { rendering: { color: 'always' } })
      .stdout,
  ).toBe('\u001b[31mX\u001b[39m');
});

test('themes reject semantic chains, reserved names, and competing owners', () => {
  for (const themes of [[{ highlight: ['info', 'bold'] }], [{ red: ['blue'] }], [{}, {}]]) {
    const result = resolve('X', { themes });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/concrete style chain|built-in style member|theme slot/u);
  }
  expect(resolve('X', { contextKey: 'identifier', themes: [{ identifier: null }] }).stdout).toBe(
    'X',
  );
  expect(
    resolve('X', {
      contextKey: 'identifier',
      rendering: { color: 'always', modifiers: 'always' },
      themes: [{ identifier: ['cyan', 'bold'] }],
    }).stdout,
  ).toBe('\u001b[36;1mX\u001b[39;22m');
});
