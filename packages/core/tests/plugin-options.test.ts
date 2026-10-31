import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/plugins/invoke.mjs', import.meta.url);

/** The fixture plugin declares `cache`, `mode`, `quiet`, and `tags`, and activates on all four. */
async function settings(argv: string[], mode = 'run') {
  return await invokeFixture(fixture, ['settings', mode, ...argv]);
}

/**
 * The settings plugin and a second plugin whose `level` option carries a validator that accepts
 * `debug`, `info`, or `warn` and outputs it in upper case. The second plugin's middleware always
 * runs and prints the `options` it received.
 */
async function validated(argv: string[], env: Record<string, string> = {}) {
  return await invokeFixture(fixture, ['validated', 'run', ...argv], { env });
}

/** The settings plugin's values when nothing supplies one, as every reader receives them. */
const defaults = '"cache":false,"mode":"plain","quiet":false,"tags":["one"]';

/** What the action printed: every global option's value, then its own option. */
const dispatched = `get:a.b:{${defaults},"raw":false}\naction-signal:true:false\n`;

test('a declared default never activates a middleware', async () => {
  await expect(settings(['get', 'a.b'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `${dispatched}resolved:0\n`,
  });
});

test.each([
  ['--quiet', 'the long spelling'],
  ['-q', 'the short spelling'],
  ['--no-cache', 'a negative Boolean form'],
])('%s activates the middleware, because it is %s of a declared option', async (token) => {
  const result = await settings([token, 'get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('settings:');
});

test("a plugin's option values reach its own middleware and every action", async () => {
  const result = await settings([
    '-q',
    '--mode',
    'fancy',
    '--tags',
    'a',
    '--tags',
    'b',
    'get',
    'a.b',
  ]);
  const values = '"cache":false,"mode":"fancy","quiet":true,"tags":["a","b"]';
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: `settings:{${values}}\nfrozen:true\nget:a.b:{${values},"raw":false}\naction-signal:true:false\nresolved:0\n`,
  });
});

test("a plugin's option is consumed at any placement, as every global option is", async () => {
  const result = await settings(['get', 'a.b', '--mode', 'fancy']);
  const values = '"cache":false,"mode":"fancy","quiet":false,"tags":["one"]';
  expect(result.stdout).toBe(
    `settings:{${values}}\nfrozen:true\nget:a.b:{${values},"raw":false}\naction-signal:true:false\nresolved:0\n`,
  );
});

test('a declared default reaches each run afresh, whatever the action wrote to it', async () => {
  // The action writes to the list it received, so a shared default would hold the write in run two.
  const result = await settings(['-q', 'get', 'a.b'], 'twice');
  const values = '"cache":false,"mode":"plain","quiet":true,"tags":["one"]';
  const run = `settings:{${values}}\nfrozen:true\nget:a.b:{${values},"raw":false}\naction-signal:true:false\n`;
  expect(result).toEqual({ status: 0, stderr: '', stdout: `${run}${run}resolved:0:0\n` });
});

test("the first-party help and version plugins' options reach the action as global options", async () => {
  await expect(
    invokeFixture(fixture, ['first-party', 'run', '-f', 'doc.json', 'get', 'a.b']),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      'get:a.b:{"file":"doc.json","help":false,"version":false,"raw":false}\naction-signal:true:false\nresolved:0\n',
  });
});

test("a plugin's validated option reaches every middleware and the action as its validator's output", async () => {
  const result = await validated(['-q', '--level', 'info', 'get', 'a.b']);
  const values = '"cache":false,"mode":"plain","quiet":true,"tags":["one"],"level":"INFO"';
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: `settings:{${values}}\nfrozen:true\nobserved:{${values}}\nget:a.b:{${values},"raw":false}\naction-signal:true:false\nresolved:0\n`,
  });
});

test("a value a plugin's option's validator rejects is an input problem, and options is null", async () => {
  await expect(validated(['--level', 'loud', 'get', 'a.b'])).resolves.toEqual({
    status: 2,
    stderr: 'app: Option "--level": Use debug, info, or warn.\n',
    stdout: 'observed:null\nresolved:2\n',
  });
});

test("a plugin's rejected option aggregates with the routed Command's own problems, globals first", async () => {
  await expect(validated(['-l', 'loud', 'get'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Option "--level": Use debug, info, or warn.\napp: Argument "path" requires a value. Supply a value for "path".\n',
    stdout: 'observed:null\nresolved:2\n',
  });
});

test('a value an environment binding fills passes the same validator', async () => {
  await expect(validated(['get', 'a.b'], { FIXTURE_LEVEL: 'loud' })).resolves.toEqual({
    status: 2,
    stderr: 'app: Option "--level" (from FIXTURE_LEVEL): Use debug, info, or warn.\n',
    stdout: 'observed:null\nresolved:2\n',
  });
  await expect(
    validated(['get', 'a.b'], { FIXTURE_LEVEL: 'warn' }).then(
      (fixtureResult) => fixtureResult.stdout,
    ),
  ).resolves.toContain(`observed:{${defaults},"level":"WARN"}`);
});

test('a fault on a local option leaves options set', async () => {
  const values = `{${defaults},"level":"WARN"}`;
  await expect(validated(['--level', 'warn', 'get', 'a.b', '--nope'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Unknown option "--nope". Supply a declared option; prefix a hyphenated path with "./".\n',
    stdout: `observed:${values}\nresolved:2\n`,
  });
  await expect(validated(['--level', 'warn', 'get'])).resolves.toEqual({
    status: 2,
    stderr: 'app: Argument "path" requires a value. Supply a value for "path".\n',
    stdout: `observed:${values}\nresolved:2\n`,
  });
});

test("a group's missing subcommand leaves options set, and a rejected global still makes it null", async () => {
  await expect(
    validated(['--level', 'debug', 'cache']).then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe(`observed:{${defaults},"level":"DEBUG"}\nresolved:2\n`);
  await expect(validated(['--level', 'loud', 'cache'])).resolves.toEqual({
    status: 2,
    stderr: 'app: Command "cache" requires a subcommand. Use one of: clear.\n',
    stdout: 'observed:null\nresolved:2\n',
  });
});

test("a structural fault in a plugin's option is held, and the faulted occurrence activates nothing", async () => {
  await expect(settings(['--mode'])).resolves.toEqual({
    status: 2,
    stderr: 'app: Option "--mode" requires a value. Supply a value after "--mode".\n',
    stdout: 'resolved:2\n',
  });
  // The first -q stands and activates the middleware, which reads null for the faulted global.
  await expect(settings(['-q', 'get', 'a.b', '-q'])).resolves.toEqual({
    status: 2,
    stderr: 'app: Option "-q" can be supplied only once. Remove the repeated option.\n',
    stdout: 'settings:null\nresolved:2\n',
  });
});

test("a plugin's letters read in a short group under the getopt rule, like any global option's", async () => {
  const values = '"cache":false,"mode":"fancy","quiet":true,"tags":["one"]';
  await expect(
    settings(['-qmfancy', 'get', 'a.b']).then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe(
    `settings:{${values}}\nfrozen:true\nget:a.b:{${values},"raw":false}\naction-signal:true:false\nresolved:0\n`,
  );
  await expect(settings(['-Zq', 'get', 'a.b'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Unknown option "-Z". Supply a declared option; prefix a hyphenated path with "./".\n',
    stdout: 'resolved:2\n',
  });
});

test("inspect() lists each plugin's options after the application's, in installation order", async () => {
  const result = await invokeFixture(fixture, ['validated', 'inspect']);
  expect(result.status).toBe(0);
  const graph = JSON.parse(result.stdout);
  expect(graph.globals.map((option: { name: string }) => option.name)).toEqual([
    'file',
    'cache',
    'mode',
    'quiet',
    'tags',
    'level',
  ]);
});

test("a plugin's option publishes the node an application's global option publishes", async () => {
  const graph = JSON.parse(
    await invokeFixture(fixture, ['validated', 'inspect']).then(
      (fixtureResult) => fixtureResult.stdout,
    ),
  );
  expect(graph.globals[2]).toEqual({
    aliases: [],
    background: false,
    control: false,
    default: { value: 'plain' },
    description: undefined,
    env: [],
    envAllowEmpty: false,
    envDelimiter: null,
    extensions: {},
    hidden: false,
    implied: null,
    long: '--mode',
    multiple: false,
    name: 'mode',
    required: false,
    requiredWhen: null,
    schema: null,
    short: '-m',
    type: 'string',
    validateOmitted: false,
    validated: false,
  });
  expect(graph.globals[1]).toEqual({
    aliases: [],
    color: false,
    control: false,
    description: undefined,
    env: [],
    extensions: {},
    hidden: false,
    interaction: false,
    long: '--cache',
    name: 'cache',
    negative: '--no-cache',
    polarity: 'both',
    schema: null,
    short: null,
    type: 'boolean',
  });
  expect(graph.globals[5]).toMatchObject({
    env: ['FIXTURE_LEVEL'],
    long: '--level',
    name: 'level',
    short: '-l',
    validated: true,
  });
  expect(graph.globals[5].schema).toMatchObject({ enum: ['debug', 'info', 'warn'] });
});
