import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';
/*
 * Acceptance plan for option parsing (docs/core/commands.md#global-consumption-and-routing).
 *
 * Option parsing is proven when public APIs alone produce these results under Node and Bun:
 *
 * - Mixed groups. `textstat -ht` renders the root's compact help page with exit code 0, and
 *   `textstat -tc .textstat.toml notes.txt` reads `-t` as the root's `total` and `-c` as the
 *   configuration plugin's `--config`.
 * - Attached values. `textstat -mwords notes.txt`, `-m=words`, and `-tmwords` set `metric` to
 *   `words`, and `-m=` hands its validator the empty string.
 * - Plain words. A fixture reads `--depth -5` and `-d -5` as the value `-5`, `-5` and `-` as
 *   arguments, and `--pattern -x` as the missing-value error that names the attached form.
 * - A parent's own option. `jsonkit --format json paths` reads the root's own `--format`, routes to
 *   `paths`, and prints its rows as JSON with exit code 0, and a fixture proves the unknown-option
 *   and misplaced-option faults when the routed Command does not declare the spelling or declares
 *   another value class, at the root and one level down.
 * - Misplaced options. `jsonkit -F name select` fails with `jsonkit: Option "-F" belongs to command
 *   "select". Supply it after "select".`, then help's hint `Run "jsonkit --help" to see the
 *   usage.`, and exit code 2, and the same words with `--help` render the root's page.
 * - Held faults. `jsonkit --file` fails with the missing-value error, `jsonkit --file --help` and
 *   `jsonkit --help --help` render help, `store cache --verbose` reports the unknown option, and
 *   `jsonkit nope --help` still reports the unknown command.
 * - A plugin's options. A fixture plugin's validated option reaches a fixture action typed as its
 *   validator's output and every middleware's `options`, a value its validator rejects is an input
 *   problem with exit code 2 and leaves `options` `null`, and a fault on a local option leaves
 *   `options` set.
 * - Counted options. `jsonkit -v keys -f doc.json`, `jsonkit keys -f doc.json -v`, and `jsonkit -vv
 *   keys -f doc.json` each write jsonkit's `Reading doc.json.` line on stderr and `jsonkit keys -f
 *   doc.json` writes none, `jsonkit --verbose=2 keys` fails with `jsonkit: Counted option
 *   "--verbose" does not accept a value. Repeat "--verbose" to raise its count.` and exit code 2,
 *   and `jsonkit -v2 keys` reports `Unknown option "-2"`. A fixture proves that `-vvv`, `-v -v -v`,
 *   `--verbose -vv`, and occurrences on both sides of the Command name each read `3`, an omitted
 *   counted option reads `0`, `-tvv` beside a Boolean `t` reads `2`, an alias's occurrences counted
 *   with the rest, `VERBOSE=3` and a configuration answer of `3` each filling `3` when no
 *   occurrence supplied it, `VERBOSE=x` failing with `Option "--verbose" (from VERBOSE): Use a
 *   whole number of 0 or more.`, and each counted-option row of Input declaration errors and
 *   Repeated string values rejected.
 * - Implied values. A fixture with `backup` implying `simple` and short alias `b` reads each form
 *   of Implied values: a bare spelling at the end of the words and before an option word supplies
 *   `simple`, `--backup numbered` reads `numbered` as the next word, `-tb` and `-bt` read as the
 *   table states, `--backup=` and `-b=` supply the empty string, a bare spelling supplies the
 *   validator's output for the implied value, a validator that rejects the implied value fails
 *   `run()` with `@loomcli/core/invalid-implied` before any token is read, a multiple option
 *   collects it in place, and the declaration rows for `implied` are rejected.
 * - Rebinding. A fixture proves that a parent's own option rebinds to a child's option of the same
 *   value class and is the misplaced-option error for each other pairing of the four value classes.
 * - One grammar. `locate` reads each form above where the parser reads it, and completion is
 *   re-proven for short groups, attached values, misplaced options, counted options, and implied
 *   values in Bash, Zsh, and Fish.
 */

async function invokeOptions(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return await invokeFixture(new URL('fixtures/options.mjs', import.meta.url), ['invoke', ...argv]);
}

test('an argument and option can share a key without losing either value', async () => {
  await expect(
    invokeFixture(new URL('fixtures/shared-input-key.mjs', import.meta.url), [
      'one.txt',
      '--files',
    ]),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":["one.txt"]},"options":{"files":true}}\n',
  });
});

test('option declarations and invocation values remain isolated across branches and repeated runs', async () => {
  await expect(
    invokeFixture(new URL('fixtures/option-state.mjs', import.meta.url)),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '{"options":{"enabled":false,"__proto__":"safe","dryRun":true,"left":true},"passthrough":["--","","two words"]}',
      '{"options":{"enabled":true,"dryRun":false,"left":false},"passthrough":[]}',
      '{"options":{"enabled":true,"dryRun":false,"right":true},"passthrough":[]}',
      '',
    ].join('\n'),
  });
});

test('local options and passthrough stay separate from positional inputs and host argv', async () => {
  const argv = ['one.txt', '--metric=words', '--total', 'two.txt', '--', '--metric', 'two words'];
  await expect(invokeOptions(argv)).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${JSON.stringify({
      args: { files: ['one.txt', 'two.txt'] },
      argv,
      options: { metric: 'words', total: true },
      passthrough: ['--metric', 'two words'],
    })}\n`,
  });
});

test.each([
  [['-tm', 'words', 'one.txt'], { metric: 'words', total: true }],
  [['--metric', 'words', 'one.txt', '-t'], { metric: 'words', total: true }],
  [['one.txt'], { total: false }],
  [['-m', '', 'one.txt'], { metric: '', total: false }],
  [['--metric=', 'one.txt'], { metric: '', total: false }],
  [['--metric=-value', 'one.txt'], { metric: '-value', total: false }],
  [['-mwords', 'one.txt'], { metric: 'words', total: false }],
  [['-m=words', 'one.txt'], { metric: 'words', total: false }],
  [['-tmwords', 'one.txt'], { metric: 'words', total: true }],
  [['-tm=words', 'one.txt'], { metric: 'words', total: true }],
  [['-mt', 'one.txt'], { metric: 't', total: false }],
  [['-m==x', 'one.txt'], { metric: '=x', total: false }],
  [['-m=', 'one.txt'], { metric: '', total: false }],
  [['-m-value', 'one.txt'], { metric: '-value', total: false }],
  [['-m=-value', 'one.txt'], { metric: '-value', total: false }],
  [['--metric', '-5', 'one.txt'], { metric: '-5', total: false }],
  [['-m', '-', 'one.txt'], { metric: '-', total: false }],
] satisfies [string[], { metric?: string; total: boolean }][])(
  'binds supported option forms %j',
  async (argv, options) => {
    await expect(invokeOptions(argv)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: `${JSON.stringify({ args: { files: ['one.txt'] }, argv, options, passthrough: [] })}\n`,
    });
  },
);

test.each([
  [[], { color: true, silent: true, total: false }],
  [['--total', '--no-color', '-s'], { color: false, silent: false, total: true }],
  [['--no-total'], { color: true, silent: true, total: false }],
  [['-tcsm', 'words'], { color: false, metric: 'words', silent: false, total: true }],
] satisfies [string[], { total: boolean; color: boolean; silent: boolean; metric?: string }][])(
  'applies polarity and short-only options for %j',
  async (argv, options) => {
    const result = await invokeFixture(new URL('fixtures/polarity.mjs', import.meta.url), argv);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toEqual({ options, passthrough: [] });
  },
);

test.each([
  [['--metric=words'], 'Unknown option'],
  [['--silent'], 'Unknown option'],
  [['--no-silent'], 'Unknown option'],
  [['--color'], 'Unknown option'],
  [['--total', '--no-total'], 'only once'],
  [['--no-total', '-t'], 'only once'],
] satisfies [string[], string][])(
  'rejects unavailable or repeated polarity forms %j',
  async (argv, reason) => {
    const result = await invokeFixture(new URL('fixtures/polarity.mjs', import.meta.url), argv);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(reason);
  },
);

test.each([
  ['duplicate-key', 'total', 'declared more than once'],
  ['duplicate-short', '-t', 'used by both'],
  ['negative-collision', '--no-total', 'used by both'],
  ['invalid-name', 'bad=name', 'name'],
])('the option() call that declares %s throws before any build', async (scenario, name, reason) => {
  const result = await invokeFixture(new URL('fixtures/option-declarations.mjs', import.meta.url), [
    scenario,
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toMatch(/^thrown:1: /u);
  expect(result.stdout).toContain(name);
  expect(result.stdout).toContain(reason);
});

test('a word that is not an option word is a value or an argument, with no -- escape', async () => {
  const argv = ['--depth', '-5', '-.5', '-5', '-', '-1e3'];
  expect(
    JSON.parse(await invokeOptions(argv).then((fixtureResult) => fixtureResult.stdout)),
  ).toMatchObject({
    args: { files: ['-.5', '-5', '-', '-1e3'] },
    options: { depth: '-5' },
  });
  expect(
    JSON.parse(
      await invokeOptions(['-d', '-5', 'one.txt']).then((fixtureResult) => fixtureResult.stdout),
    ),
  ).toMatchObject({
    options: { depth: '-5' },
  });
  expect(
    JSON.parse(
      await invokeOptions(['-td-.5', 'one.txt']).then((fixtureResult) => fixtureResult.stdout),
    ),
  ).toMatchObject({
    options: { depth: '-.5', total: true },
  });
});

test.each([
  [['--pattern', '-x', 'one.txt'], '--pattern'],
  [['--metric', '--total', 'one.txt'], '--metric'],
  [['-m', '-v', 'one.txt'], '-m'],
  [['-m', '--', 'one.txt'], '-m'],
  [['one.txt', '-tm', '--total'], '-m'],
] satisfies [string[], string][])(
  'a value option before an option word or -- names the attached form for %j',
  async (argv, spelling) => {
    await expect(invokeOptions(argv)).resolves.toEqual({
      status: 2,
      stderr: `options: Option "${spelling}" requires a value. Supply a value after "${spelling}", or attach one that starts with a hyphen as "${spelling}=<value>".\n`,
      stdout: '',
    });
  },
);

test.each([
  [['-tx', 'one.txt'], 'Unknown option "-x"'],
  [['-t5', 'one.txt'], 'Unknown option "-5"'],
  [['-té', 'one.txt'], 'Unknown option "-é"'],
  [['-t=false', 'one.txt'], 'Boolean option "-t" does not accept a value'],
  [['-tt', 'one.txt'], 'Option "-t" can be supplied only once'],
  [['-tmx', '-tm', 'y', 'one.txt'], 'Option "-t" can be supplied only once'],
] satisfies [string[], string][])('the short group %j fails with %s', async (argv, sentence) => {
  const result = await invokeOptions(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(`options: ${sentence}`);
});

test.each([
  [['--metric'], '"--metric"', 'requires a value'],
  [['--metric', 'words', '-m', 'bytes', 'one.txt'], '"-m"', 'only once'],
  [['--total', '-t', 'one.txt'], '"-t"', 'only once'],
  [['-tt', 'one.txt'], '"-t"', 'only once'],
  [['--total=false', 'one.txt'], '"--total"', 'does not accept a value'],
  [['-t=false', 'one.txt'], '"-t"', 'does not accept a value'],
  [['--unknown', 'one.txt'], '"--unknown"', 'Unknown option'],
  [['-tx', 'one.txt'], '"-x"', 'Unknown option'],
  [['--no-total', 'one.txt'], '"--no-total"', 'Unknown option'],
  [['--', 'one.txt'], '"files"', 'requires at least one value'],
] satisfies [string[], string, string][])(
  'rejects %j without dispatch',
  async (argv, option, reason) => {
    const result = await invokeOptions(argv);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(option);
    expect(result.stderr).toContain(reason);
  },
);
