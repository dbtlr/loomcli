// @module-tag docs

/*
 * Acceptance plan for the marked-string wire contract (docs/maintaining/style-wire.md).
 *
 * Implementation acceptance includes these cases through both width measurement and final output:
 *
 * - Every delimiter as literal input, escaped once, escaped twice, and next to a valid frame.
 * - Unknown tokens and glyphs, malformed JSON, truncated headers, extra closes, and unterminated
 *   recognized frames.
 * - A recognized glyph header with a nonempty body, preserving the malformed frame as literal text.
 * - A known token without a mapping, a custom undefined mapping, and a literal string resembling a
 *   complete registered frame.
 * - Nested styles, reset variants, embedded ANSI resets, and an ANSI reset inside a padded frame.
 * - A multi-character compatibility glyph inside nested padding and escaped delimiters inside a
 *   measured value.
 * - A no-wrap frame holding a style, a glyph, or a padding frame, and nested inside each, resolving
 *   to its body byte for byte, and a `["nowrap", 1]` header kept as literal text.
 * - Large malformed headers without quadratic header rescanning, and deep unchanged padding without
 *   recursive-stack failure or repeated Unicode analysis.
 * - Unclosed ANSI styling and hyperlinks followed by a separate output call, with no leaked
 *   formatting.
 * - Loom frame boundaries inside raw OSC payloads and raw ANSI commands split across Loom frames,
 *   under disabled styling policies.
 *
 * Acceptance plan for explicit color fallbacks (docs/core/styles.md#explicit-color-fallbacks).
 *
 * The implementation verifies exact bytes for explicit and omitted fallbacks at all three depths,
 * including `ansi256` source colors and background helpers. It verifies that an index passed by a
 * direct array callback is rejected and an explicit one-argument wrapper succeeds. It covers
 * partial and `undefined` options, invalid options at helper-call time, copied option values,
 * whole-color replacement, nested restoration, embedded resets, and color suppression. Type checks
 * reject invalid fields and names while preserving chain typing. The wire checks validate the new
 * color forms and retain the existing forms, as specified in the wire contract
 * (docs/maintaining/style-wire.md#explicit-color-fallbacks). Node and Bun process fixtures plus
 * packed consumers prove the public API.
 *
 * Acceptance plan for styles and rendering policy (docs/core/styles.md).
 *
 * The style tests and packed consumers cover these obligations:
 *
 * - Chaining, nesting, each reset, no-theme inheritance, and rejection of token references in theme
 *   mappings.
 * - Every foreground, background, modifier, and custom-color helper, including invalid arguments
 *   and capability degradation.
 * - The complete pinned glyph catalog, semantic aliases, multi-character compatibility forms, and
 *   independence from themes and ANSI policy.
 * - Automatic custom-name inference in detached Commands and views after the registration
 *   prerequisite, with typo and reserved-name rejection.
 * - Every rendering-policy field, invocation override behavior, nonempty `"0"` environment values,
 *   conflicting variables, and independent destinations under one policy.
 * - Embedded ANSI colors and resets, separate hyperlink and terminal-control policies, and
 *   malformed control strings.
 * - Literal marker data, nested deferred padding, Unicode width, tabs, multiline strings, and the
 *   adversarial cases in the wire contract.
 * - Fresh host capture on repeated runs, no import-time capability capture, and equivalent output
 *   under Node and Bun.
 * - Columns per destination: a view rendered to stdout reads stdout's width and one rendered to
 *   stderr reads stderr's, when the two streams report different widths and when only one is a
 *   terminal.
 * - Columns without a terminal: a pipe, a redirect to a file, `app.invoke`, and an MCP tool call
 *   each read `columns` as `undefined`, with `COLUMNS=60` set as well, and `wrap` returns the text
 *   unchanged.
 * - Live width: under a pty-backed host, one run renders twice either side of a resize, and the
 *   first render reads 100 columns and the second 60. The first render's text is not redrawn.
 *   `host.terminal.stdout.columns` and `host.terminal.stderr.columns` read the new width after the
 *   resize, and a reported 0 reads `undefined`.
 * - `COLUMNS` only narrows on a terminal destination: `COLUMNS=60` over a real width of 100 gives
 *   `columns` 60, `COLUMNS=150` over 100 gives 100, and `060` over 100 gives 60. `COLUMNS` set to
 *   ` 60`, `+60`, `60 `, `6e1`, `0`, `abc`, `-5`, `60.5`, an empty string, or an integer beyond the
 *   safe range leaves 100.
 * - `COLUMNS` on a terminal that reports no width: it reads `COLUMNS=60` as 60 and reads
 *   `undefined` without `COLUMNS`. `COLUMNS=60` on a pipe leaves `undefined`.
 * - The host facts stay real: `host.terminal.stdout.columns` and `host.terminal.stderr.columns`
 *   read the real width and never reflect `COLUMNS`. A host override of plain numbers stays fixed
 *   across renders, and an override that supplies a getter is read each time. `isTTY` is captured
 *   once.
 * - `out.draw` resolves the row count for the real stderr width read at that draw, under
 *   `COLUMNS=60` and after a resize alike.
 * - Greedy fitting: each output line takes as many words as fit within `columns`, and a line
 *   exactly `columns` wide stays on one line, while a line one column wider breaks.
 * - Breaks at spaces only: a break only at U+0020, never at a tab, and runs of spaces inside a line
 *   kept.
 * - `expandTabs`: each tab becomes spaces to the next multiple of eight from the start of its input
 *   line, each line of a CRLF or LF text counted alone, measured in the destination's glyph forms,
 *   so a tab after `◉` takes seven spaces and after `(*)` five. A tab inside a style frame or a
 *   `nowrap` frame expands and the frame resolves as before, a tab inside a `pad` frame is left to
 *   the frame, and a tab inside an OSC 8 payload stays.
 * - Tabs in a lane: on a terminal 11 columns wide, `out.warn('aaaaaa\tb c')` prints `⚠ aaaaaa  b`
 *   and then `  c`, so no line passes 11 columns and none holds a tab, and the same holds for the
 *   message inside `nowrap` and inside a style. Off a terminal, the lane keeps the tab, and `print`
 *   keeps it everywhere.
 * - Line breaks: LF and CRLF kept, with each input line wrapped alone, and an inserted break is LF,
 *   or CRLF on an input line that ends in CRLF.
 * - Leading spaces: an input line's leading spaces are never a break and stay with its first word,
 *   so an indented path wider than `columns` keeps its indent on its own line.
 * - Trailing spaces: spaces at the end of an input line are never a break, stay with its last word,
 *   and count toward the fit, so `ab cd   ` at 5 columns breaks before `cd   `, and a records value
 *   or a table cell whose trailing space would pass the width wraps instead of overflowing.
 * - Dropped spaces: the spaces at a break are dropped, and continuation lines start at column 0.
 * - A word wider than `columns` stays whole on its own line, for a URL, a token, a hash, a path
 *   without spaces, and any text inside `nowrap`.
 * - A `pad` frame or a `nowrap` frame is one unit: `wrap` measures a `pad` frame at its padded
 *   width and a `nowrap` frame at its body's width, and never breaks inside either.
 * - `nowrap`: a body never breaks at any `columns`, and it resolves byte for byte to its body, so a
 *   printed `nowrap` path copies as the exact text. A lane message holding
 *   `nowrap('/Users/a/Library/Application Support/x')` at a narrow width keeps the path on one
 *   line, and the text around it wraps. A table cell in `nowrap` raises its column's floor to the
 *   whole cell. A style or a glyph inside the frame, and the frame inside a `pad` frame, resolve as
 *   without it. A non-string throws `TypeError('Style helpers require a string.')`, as `pad` does.
 * - First-party messages: each filesystem path and URL a first-party message prints through a lane,
 *   a view, or a `FatalError` is inside `nowrap`, the service status view's unit path included, and
 *   the message text is byte for byte what it was. A `nowrap` frame in an `InputError`'s message
 *   prints its delimiters on a pipe and on a terminal, while one in a `FatalError`'s message
 *   resolves to its body on both, so the configuration plugin's named-file failure and a wrong
 *   value's label print a path that holds spaces whole and unmarked.
 * - `splitLines` frames: a style, a `pad` frame, and a `nowrap` frame that span a line break close
 *   at the line's end and open again on the next line, nested frames in their order, and a frame
 *   closed before the break stays closed. A style header that names a theme token splits like any
 *   style, and an escaped delimiter or a glyph frame is text.
 * - `splitLines` embedded ANSI: an embedded SGR color, set at the top level, inside a style, or
 *   inside a `pad` frame, ends at each line's end and is set again on the next, and an embedded OSC
 *   8 hyperlink closes at each line's end and opens again on the next.
 * - `splitLines` breaks: LF and CRLF split alike and are dropped, a trailing line break adds no
 *   empty line while a blank line inside the text stays, a `pad` frame after the last break is a
 *   line, a line break inside a control string does not split, text without a break comes back
 *   unchanged, and a non-string throws `TypeError('Style helpers require a string.')`.
 * - A style and a hyperlink that span a break continue across it, with the break inside the
 *   envelope as an authored line break sits, as a rendering with color and hyperlinks on shows, and
 *   a lane's gutter on a continuation line carries the span.
 * - Glyph measurement per destination: a message with a marked glyph whose main and compatibility
 *   forms differ in width breaks at different points for a destination that selects main forms and
 *   one that selects compatibility forms.
 * - Text without spaces, such as Chinese, Japanese, and Thai prose, comes back unbroken at any
 *   `columns`.
 * - `wrap` rejects `0`, a negative number, a fraction, `NaN`, `Infinity`, and an unsafe integer
 *   with `RangeError` and the sentence `Wrap width must be a positive safe integer.`, and
 *   `pad(wrap(text, n), n, { align: 'center' })` centers each line.
 * - Marked lanes: `info`, `success`, `warn`, `error`, `debug`, and `trace` wrap a long message at
 *   `columns` minus the measured glyph gutter where `columns` is defined and leave it unwrapped
 *   when no column remains after the gutter, continuation lines carry the gutter, authored line
 *   breaks keep their gutter, and `print` does not wrap.
 * - Golden fixtures that run without a terminal are byte for byte unchanged, for every lane, the
 *   table, the records view, and the lanes of an invocation by name.
 * - The update notice: on an 80-column stderr terminal the notice wraps with the info lane's gutter
 *   on its continuation line, and on a pipe it stays one line.
 * - Failure text: core's default text for each failure class stays one line per sentence on a
 *   terminal narrower than the sentence and on a pipe, and an override that calls `context.wrap`
 *   wraps its own text. A failure view override receives `columns`, `wrap`, and `expandTabs`. Help
 *   pages wrap under Help wraps to the destination's columns
 *   (docs/plugins/help-page.md#help-wraps-to-the-destinations-columns).
 * - The Developer Diagnostic's explanation breaks at stderr's effective width with the same line
 *   breaker as `context.wrap`, and a word wider than that width keeps its own line. On a 100-column
 *   stderr terminal the banner fills 100 columns and the explanation wraps at 100, and under
 *   `COLUMNS=60` they fill 60. With no width, they use 80, and so does a stderr that is not a
 *   terminal even when a host override reports a width. An explanation with wide characters wraps
 *   by display width, not by string length.
 *
 * Process fixtures run on Node and Bun. Named-theme whole-token replacement belongs to Loom theme
 * (docs/plugins/theme.md). Fallback-option coverage belongs to the fallback acceptance plan in this
 * file.
 */

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
  const catalog = readFileSync(
    new URL('../../../docs/maintaining/glyphs.md', import.meta.url),
    'utf8',
  );
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

const unbroken = (body: string) => `\uE000["nowrap"]\uE001${body}\uE002`;

test('a no-wrap frame resolves to its body byte for byte and measures as its body', () => {
  const radio = '\uE000["glyph","radioOn"]\uE001\uE002';
  const color = { rendering: { color: 'always' } };
  expect(resolve(unbroken(redSpan(`a\tb ${radio}`)), color).stdout).toBe(
    '\u001b[31ma\tb ◉\u001b[39m',
  );
  expect(resolve(redSpan(`A${unbroken('B')}C`), color).stdout).toBe('\u001b[31mABC\u001b[39m');
  expect(resolve(unbroken(radio), { env: { TERM: 'linux' } }).stdout).toBe('(*)');
  expect(resolve(padded(unbroken('ab'), 4)).stdout).toBe('ab  ');
  expect(resolve(unbroken(padded('ab', 4))).stdout).toBe('ab  ');
  expect(resolve(unbroken('a\tb'), { measure: true }).stdout).toBe('9');
  expect(resolve(unbroken(unbroken('a b'))).stdout).toBe('a b');
  const malformed = '\uE000["nowrap",1]\uE001X\uE002';
  expect(resolve(malformed).stdout).toBe(malformed);
});

test('nowrap builds the no-wrap frame and rejects a value that is not a string', () => {
  expect(resolve('/Users/a/Application Support', { nowrap: true }).stdout).toBe(
    '/Users/a/Application Support',
  );
  expect(resolve('', { nowrapProbe: true }).stdout).toBe(
    `${unbroken('a b')}\nTypeError: Style helpers require a string.\n`,
  );
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

test('two plugins that claim the theme slot are a fault, and one theme resolves its entries', () => {
  const result = resolve('X', { themes: [{}, {}] });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(/theme slot/u);
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

test.each([
  [{}, '32'],
  [{ TERM: 'xterm-256color' }, '38;5;108'],
  [{ COLORTERM: 'truecolor' }, '38;2;122;143;123'],
])('explicit RGB fallbacks select only the destination depth %j', (env, code) => {
  expect(
    resolve('X', {
      chain: [['hex', '#7A8F7B', { ansi16: 'green', ansi256: 108 }]],
      env: { FORCE_COLOR: '1', ...env },
    }),
  ).toEqual({ status: 0, stderr: '', stdout: `\u001b[${code}mX\u001b[39m` });
});

test('fallback helpers validate at construction and copy accepted values', () => {
  expect(invoke(new URL('fixtures/color-fallbacks.mjs', import.meta.url))).toEqual({
    status: 0,
    stderr: '',
    stdout: 'validated and copied\n',
  });
});

test.each([
  [[], '90', '90'],
  [[{}], '90', '90'],
  [[{ ansi256: 108 }], '90', '38;5;108'],
  [[{ ansi16: 'green' }], '32', '90'],
])('fallbacks %j never affect another depth', (options, ansi16, ansi256) => {
  for (const [env, code] of [
    [{}, ansi16],
    [{ TERM: 'xterm-256color' }, ansi256],
    [{ COLORTERM: 'truecolor' }, '38;2;122;143;123'],
  ] as const) {
    expect(
      resolve('X', {
        chain: [['rgb', 122, 143, 123, ...options]],
        env,
        rendering: { color: 'always' },
      }).stdout,
    ).toBe(`\u001b[${code}mX\u001b[39m`);
  }
});

test.each([
  [['ansi256', 108, { ansi16: 'green' }], '32', '38;5;108', '38;5;108', '39'],
  [['ansi256', 108], '90', '38;5;108', '38;5;108', '39'],
  [['bgAnsi256', 108, { ansi16: 'green' }], '42', '48;5;108', '48;5;108', '49'],
  [
    ['bgHex', '#7A8F7B', { ansi16: 'green', ansi256: 108 }],
    '42',
    '48;5;108',
    '48;2;122;143;123',
    '49',
  ],
  [
    ['bgRgb', 122, 143, 123, { ansi16: 'green', ansi256: 108 }],
    '42',
    '48;5;108',
    '48;2;122;143;123',
    '49',
  ],
])('color helper %j uses explicit fallbacks', (helper, ansi16, ansi256, truecolor, reset) => {
  for (const [env, code] of [
    [{}, ansi16],
    [{ TERM: 'xterm-256color' }, ansi256],
    [{ COLORTERM: 'truecolor' }, truecolor],
  ] as const) {
    expect(resolve('X', { chain: [helper], env, rendering: { color: 'always' } }).stdout).toBe(
      `\u001b[${code}mX\u001b[${reset}m`,
    );
  }
});

test('whole-color replacement and background composition preserve independent choices', () => {
  const sage = ['hex', '#7A8F7B', { ansi16: 'green', ansi256: 108 }];
  expect(resolve('X', { chain: [sage, 'blue'], rendering: { color: 'always' } }).stdout).toBe(
    '\u001b[34mX\u001b[39m',
  );
  expect(
    resolve('X', {
      chain: [sage, ['bgHex', '#C04532', { ansi16: 'red' }]],
      rendering: { color: 'always' },
    }).stdout,
  ).toBe('\u001b[32;41mX\u001b[39;49m');
  expect(resolve('X', { chain: [sage], env: { NO_COLOR: '1' }, tty: true }).stdout).toBe('X');
  expect(resolve('X', { chain: [sage] }).stdout).toBe('X');
});

test.each([
  [{}, '32', '42'],
  [{ TERM: 'xterm-256color' }, '38;5;108', '48;5;108'],
  [{ COLORTERM: 'truecolor' }, '38;2;122;143;123', '48;2;122;143;123'],
])('nested and embedded resets restore fallback colors at %j', (env, foreground, background) => {
  const options = {
    chain: [
      ['hex', '#7A8F7B', { ansi16: 'green', ansi256: 108 }],
      ['bgHex', '#7A8F7B', { ansi16: 'green', ansi256: 108 }],
      'bold',
    ],
    env,
    rendering: { color: 'always', modifiers: 'always' },
  };
  expect(resolve(`A${redSpan('B')}C\u001b[34;45mD\u001b[0mE`, options).stdout).toBe(
    `\u001b[${foreground};${background};1mA\u001b[31mB\u001b[${foreground}mC\u001b[34;45mD\u001b[${foreground};${background}mE\u001b[39;49;22m`,
  );
});

test.each([
  ['rgb', 122, 143, 123, { ansi16: null }],
  ['rgb', 122, 143, 123, { ansi256: null }],
  ['rgb', 122, 143, 123, { ansi256: 256 }],
  ['rgb', 122, 143, 123, { ansi16: 'bgGreen' }],
  ['rgb', 122, 143, 123, { unknown: 1 }],
  ['rgb', 122, 143, 123, null],
  ['rgb', 122, 143, 123, {}, {}],
  ['ansi256', 108, { ansi256: 108 }],
  ['ansi256', 108, { ansi16: null }],
  ['ansi256', 108, null],
  ['ansi256', 108, {}, {}],
])('malformed fallback wire color %j stays literal and measurable', (...color) => {
  const text = `\uE000${JSON.stringify(['style', [['foreground', color]]])}\uE001X\uE002`;
  expect(resolve(text).stdout).toBe(text);
  expect(resolve(text, { measure: true }).stdout).toBe(String(text.length));
});

test.each([
  [['rgb', 122, 143, 123], '90'],
  [['rgb', 122, 143, 123, {}], '90'],
  [['rgb', 122, 143, 123, { ansi16: 'green' }], '32'],
  [['ansi256', 108], '90'],
  [['ansi256', 108, {}], '90'],
  [['ansi256', 108, { ansi16: 'green' }], '32'],
])('valid wire color %j resolves through output and width', (color, code) => {
  const text = `\uE000${JSON.stringify(['style', [['foreground', color]]])}\uE001X\uE002`;
  expect(resolve(text, { rendering: { color: 'always' } }).stdout).toBe(
    `\u001b[${code}mX\u001b[39m`,
  );
  expect(resolve(text, { measure: true }).stdout).toBe('1');
});
