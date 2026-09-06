import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function invokeSpellings(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return invoke(new URL('fixtures/spellings.mjs', import.meta.url), ['invoke', ...argv]);
}

/** Ordered entries, because the globals bind before a Command's own options in `options`. */
function report(command: string, options: [string, unknown][]) {
  const bound = Object.fromEntries(options);
  return `${JSON.stringify({ args: {}, command, options: bound, passthrough: [] })}\n`;
}

test.each([
  [['select', '--field', 'a', '-F', 'b'], 'select', [['field', ['a', 'b']]]],
  [['select'], 'select', [['field', []]]],
  [['count', '--field'], 'count', [['field', true]]],
  [['count', '--no-field'], 'count', [['field', false]]],
  [['count', '-F'], 'count', [['field', true]]],
  [['count'], 'count', [['field', false]]],
  [['cache', 'set', '-F', 'x'], 'set', [['field', 'X']]],
  [['cache', 'set'], 'set', []],
] satisfies [string[], string, [string, unknown][]][])(
  'one spelling reads its own value shape for %j',
  (argv, command, options) => {
    expect(invokeSpellings(argv)).toEqual({
      status: 0,
      stderr: '',
      stdout: report(command, options),
    });
  },
);

test('the global alias and a local alias of the same letter case stay separate', () => {
  expect(invokeSpellings(['select', '-F', 'a', '-f', 'doc.json', '-F', 'b'])).toEqual({
    status: 0,
    stderr: '',
    stdout: report('select', [
      ['file', 'doc.json'],
      ['field', ['a', 'b']],
    ]),
  });
  expect(invokeSpellings(['-f', 'doc.json', 'cache', 'set', '--field=x'])).toEqual({
    status: 0,
    stderr: '',
    stdout: report('set', [
      ['file', 'doc.json'],
      ['field', 'X'],
    ]),
  });
});

test('a hyphen token commits to the Command that owns the spelling', () => {
  expect(invokeSpellings(['count', '--field', 'select'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Command "count" accepts no arguments. Remove the supplied values.\n',
    stdout: '',
  });
  expect(invokeSpellings(['--field', 'name', 'select'])).toEqual({
    status: 2,
    stderr:
      'Invalid input: Unknown option "--field". Supply a declared option; prefix a hyphenated path with "./".\n',
    stdout: '',
  });
  expect(invokeSpellings(['cache', '--field', 'x'])).toEqual({
    status: 2,
    stderr: 'Invalid input: Command "cache" requires a subcommand. Use one of: set.\n',
    stdout: '',
  });
});

test.each([
  [['select', '--no-field'], '"--no-field"'],
  [['count', '--field=true'], '"--field"'],
  [['cache', 'set', '--no-field'], '"--no-field"'],
  [['select', '-F'], '"-F"'],
])('a sibling shape never accepts %j', (argv, spelling) => {
  const result = invokeSpellings(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(spelling);
});
