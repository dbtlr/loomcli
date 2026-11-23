import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

async function invokeSpellings(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return await invokeFixture(new URL('fixtures/spellings.mjs', import.meta.url), [
    'invoke',
    ...argv,
  ]);
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
  async (argv, command, options) => {
    await expect(invokeSpellings(argv)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: report(command, options),
    });
  },
);

test('the global alias and a local alias of the same letter case stay separate', async () => {
  await expect(
    invokeSpellings(['select', '-F', 'a', '-f', 'doc.json', '-F', 'b']),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: report('select', [
      ['file', 'doc.json'],
      ['field', ['a', 'b']],
    ]),
  });
  await expect(invokeSpellings(['-f', 'doc.json', 'cache', 'set', '--field=x'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: report('set', [
      ['file', 'doc.json'],
      ['field', 'X'],
    ]),
  });
});

test('an option word no global option declares ends routing, and names the Commands that declare it', async () => {
  await expect(invokeSpellings(['count', '--field', 'select'])).resolves.toEqual({
    status: 2,
    stderr: 'spellings: Command "count" accepts no arguments. Remove the supplied values.\n',
    stdout: '',
  });
  await expect(invokeSpellings(['--field', 'name', 'select'])).resolves.toEqual({
    status: 2,
    stderr:
      'spellings: Option "--field" belongs to commands select, count, cache set. Supply it after the command name.\n',
    stdout: '',
  });
  await expect(invokeSpellings(['cache', '--field', 'x'])).resolves.toEqual({
    status: 2,
    stderr:
      'spellings: Option "--field" belongs to command "cache set". Supply it after "cache set".\n',
    stdout: '',
  });
});

test.each([
  [['select', '--no-field'], '"--no-field"'],
  [['count', '--field=true'], '"--field"'],
  [['cache', 'set', '--no-field'], '"--no-field"'],
  [['select', '-F'], '"-F"'],
])('a sibling shape never accepts %j', async (argv, spelling) => {
  const result = await invokeSpellings(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(spelling);
});
