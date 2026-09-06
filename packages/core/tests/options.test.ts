import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function invokeOptions(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return invoke(new URL('fixtures/options.mjs', import.meta.url), ['invoke', ...argv]);
}

test('an argument and option can share a key without losing either value', () => {
  expect(
    invoke(new URL('fixtures/shared-input-key.mjs', import.meta.url), ['one.txt', '--files']),
  ).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"args":{"files":["one.txt"]},"options":{"files":true}}\n',
  });
});

test('option declarations and invocation values remain isolated across branches and repeated runs', () => {
  expect(invoke(new URL('fixtures/option-state.mjs', import.meta.url))).toEqual({
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

test('local options and passthrough stay separate from positional inputs and host argv', () => {
  const argv = ['one.txt', '--metric=words', '--total', 'two.txt', '--', '--metric', 'two words'];
  expect(invokeOptions(argv)).toEqual({
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
] satisfies [string[], { metric?: string; total: boolean }][])(
  'binds supported option forms %j',
  (argv, options) => {
    expect(invokeOptions(argv)).toEqual({
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
  (argv, options) => {
    const result = invoke(new URL('fixtures/polarity.mjs', import.meta.url), argv);
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
  (argv, reason) => {
    const result = invoke(new URL('fixtures/polarity.mjs', import.meta.url), argv);
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain(reason);
  },
);

test.each([
  ['nonstring-name', 'Option names', 'strings'],
  ['symbol-short', 'flag', 'one ASCII letter'],
  ['nonboolean-short-only', 'flag', 'shortOnly must be Boolean'],
  ['duplicate-key', 'total', 'declared more than once'],
  ['duplicate-short', '-t', 'used by both'],
  ['negative-collision', '--no-total', 'used by both'],
  ['missing-short', 'metric', 'requires a short alias'],
  ['both-short-only', 'total', 'both polarities'],
  ['string-polarity', 'metric', 'Boolean'],
  ['invalid-short', 'metric', 'one ASCII letter'],
  ['invalid-name', 'bad=name', 'name'],
  ['invalid-type', 'metric', 'type'],
  ['invalid-polarity', 'total', 'polarity'],
])('rejects %s during graph construction before input errors', (scenario, name, reason) => {
  const result = invoke(new URL('fixtures/option-declarations.mjs', import.meta.url), [scenario]);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('assembled\nresolved:1\n');
  expect(result.stderr).toContain('Invalid declaration:');
  expect(result.stderr).toContain(name);
  expect(result.stderr).toContain(reason);
});

test.each([
  [['-mwords', 'one.txt'], '"-m"', 'last'],
  [['-m=words', 'one.txt'], '"-m"', 'last'],
  [['-mt', 'words', 'one.txt'], '"-m"', 'last'],
  [['--metric', '--total', 'one.txt'], '"--metric"', 'requires a value'],
  [['-m', '--', 'one.txt'], '"-m"', 'requires a value'],
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
] satisfies [string[], string, string][])('rejects %j without dispatch', (argv, option, reason) => {
  const result = invokeOptions(argv);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain(option);
  expect(result.stderr).toContain(reason);
});
