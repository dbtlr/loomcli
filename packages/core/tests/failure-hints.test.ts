import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for failure hints (docs/core/lifecycle-hooks.md#failure-hints).
 *
 * A failure hook, such as the private `@loom/explain` plugin's, answers one failure class and returns
 * a hint line built from `application`, `path`, and the command line, joined by single spaces. An
 * application that does not override the failure's view prints core's default text with the hint
 * under its sentence, and a hook that answers no other class leaves every other diagnostic
 * unchanged. A fault raised on the root has an empty `path`.
 *
 * The acceptance tests cover, through public APIs with fixture applications and fixture plugins: an
 * override reading `application` and `path` for a structural fault on a global option before any
 * child name, `[]`; for a local-option fault on a nested Command, its routed path; for an unknown
 * Command under a group, the partial path to the group; and for a build fault, the application
 * name, `[]`, and no hints; a declared default or implied value its validator rejects, for which
 * the hook runs with `path` `[]` and `command` the root; a fault reported after the primary
 * outcome, such as a view's throw in an `out.render` call the action never awaited, receiving hook
 * calls of its own; two plugins' hints under core's default text in installation order, with a line
 * both return printed twice; an override receiving the hints and printing them in its own form; a
 * hook returning `undefined`, and one returning `[]`, beside which the default text is unchanged
 * byte for byte; a hook that throws ahead of a working one, which then is not called, writing
 * core's default text with no hint, then the generic line, and returning 1 for a usage error that
 * carried 2; a hook whose reason holds a line break or control characters, and a broken failure
 * view whose reason does, each writing one escaped line; a JavaScript hook assigning `exitCode`
 * leaving the resolved code unchanged; a hook that throws beside a failure view that would break,
 * writing core's default text and calling no view; a hook that throws in a run a caller cancelled
 * whose failure still renders, returning 130; no hook call for a build fault, for a run a caller
 * cancelled whose action rejects with the signal's reason, or for `--help` taking over a held
 * unknown-option fault; the plain fallback under a broken failure view writing no hints; an issue
 * with an extra `code` field on the second value of a variadic argument reaching an `InputError`
 * override with `code` intact and `path` `[1]`, and the same on the second value of a multiple
 * option; and a hook reading `graph` and `command`, which for an unknown option on a nested Command
 * suggests a visible global or local spelling and never a hidden or deprecated one, and for an
 * unknown Command under a group suggests a visible child by its canonical name and never an alias.
 * Each case runs under Node and Bun.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

async function run(scenario: string, argv: string[] = [], env: Record<string, string> = {}) {
  return await invokeFixture(new URL('fixtures/hints.mjs', import.meta.url), [scenario, ...argv], {
    env,
  });
}

/** A development build reports a throwing hook's throw as a foreign throw, its reason the sentence. */
async function expectBrokenHook(scenario: string, reason: string) {
  const { stderr } = await run(scenario, ['cache', 'clear', '--bogus'], {
    FIXTURE_BUILD: 'development',
  });
  expect(stderr).toContain(` @loomcli/core/foreign-throw\n\n${reason}\n`);
}

const unknownBogus =
  'store: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n';

/** The context one failure view read, which the `where` override serializes as one line. */
async function seen(argv: string[], scenario = 'context') {
  const result = await run(scenario, argv);
  return { context: JSON.parse(result.stderr), stdout: result.stdout };
}

test('a global-option fault before any Command name reads the application name and an empty path', async () => {
  await expect(seen(['--file']).then((fixtureResult) => fixtureResult.context)).resolves.toEqual({
    application: 'store',
    hints: [],
    name: 'MissingValueError',
    path: [],
  });
});

test('a local-option fault on a nested Command reads its routed path', async () => {
  await expect(
    seen(['cache', 'clear', '--bogus']).then((fixtureResult) => fixtureResult.context),
  ).resolves.toEqual({
    application: 'store',
    hints: [],
    name: 'UnknownOptionError',
    path: ['cache', 'clear'],
  });
});

test('an unknown Command under a group reads the partial path to the group', async () => {
  await expect(
    seen(['cache', 'nope']).then((fixtureResult) => fixtureResult.context),
  ).resolves.toEqual({
    application: 'store',
    hints: [],
    name: 'UnknownCommandError',
    path: ['cache'],
  });
});

test('an alias reports its Command canonical name in the path', async () => {
  await expect(
    seen(['cache', 'ls', '--bogus']).then((fixtureResult) => fixtureResult.context.path),
  ).resolves.toEqual(['cache', 'list']);
});

test('a build fault reads the application name, an empty path, and no hints, and calls no hook', async () => {
  await expect(seen([], 'build-fault')).resolves.toEqual({
    context: { application: 'store', hints: [], name: 'DeclarationError', path: [] },
    stdout: 'resolved:1\n',
  });
});

test("a development build's converter failure is a build fault that calls no hook", async () => {
  const result = await run('converter-fault');
  expect(result.stdout).toBe('resolved:1\n');
  expect(result.stderr).toContain(' @loomcli/core/schema-converter-failed\n');
  expect(result.stderr).not.toContain('converter-fault hint');
});

test('a declared default its validator rejects calls the hook with an empty path at the root', async () => {
  const result = await run('default-rejected');
  expect(result.stdout).toBe('hook:fixture/one:DeclarationError:[]\nresolved:1\n');
  expect(result.stderr).toBe('store: Something went wrong.\ncommand at []\n');
});

test('a fault reported after the primary outcome receives hook calls of its own', async () => {
  const result = await run('after-primary');
  expect(result).toEqual({
    status: 1,
    stderr:
      'The action failed.\nhint for FatalError\nstore: Something went wrong.\nhint for InternalError\n',
    stdout: 'hook:fixture/one:FatalError:[]\nhook:fixture/one:InternalError:[]\nresolved:1\n',
  });
});

test('a JavaScript hook that assigns exitCode leaves the resolved code alone', async () => {
  await expect(run('assigns-exit-code', ['cache', 'clear', '--bogus'])).resolves.toEqual({
    status: 2,
    stderr: `${unknownBogus}hinted\n`,
    stdout: 'hook:fixture/one:UnknownOptionError:[cache,clear]\nresolved:2\n',
  });
});

test('a hook reads the same graph a middleware read, built once for the run', async () => {
  await expect(run('shared-graph').then((fixtureResult) => fixtureResult.stderr)).resolves.toBe(
    'The action failed.\nsame graph: true\n',
  );
});

test("two plugins' hints print under core's default text in installation order, a shared line twice", async () => {
  await expect(run('two-plugins', ['cache', 'clear', '--bogus'])).resolves.toEqual({
    status: 2,
    stderr: `${unknownBogus}first\nshared\nshared\n`,
    stdout:
      'hook:fixture/one:UnknownOptionError:[cache,clear]\nhook:fixture/two:UnknownOptionError:[cache,clear]\nresolved:2\n',
  });
});

test('hints under a diagnostic of several problem lines stay unprefixed', async () => {
  await expect(run('two-problems', ['--left', 'x', '--right', 'y'])).resolves.toEqual({
    status: 2,
    stderr: 'store: Option "--left": No.\nstore: Option "--right": No.\nfirst\nsecond\n',
    stdout: 'hook:fixture/one:InputError:[]\nresolved:2\n',
  });
});

test('an override receives the hints and prints them in its own form', async () => {
  await expect(
    run('override-hints', ['cache', 'clear', '--bogus']).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe(
    'usage: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n  (first)\n  (second)\n',
  );
});

test('a hint is marked text core resolves for stderr, not escaped text', async () => {
  const escape = String.fromCodePoint(27);
  const { stderr } = await run('marked-hint', ['cache', 'clear', '--bogus']);
  expect(stderr.split('\n').at(1)).toBe(`plain ${escape}[1mbold${escape}[22m`);
});

test('hooks returning undefined and [] leave the default text unchanged byte for byte', async () => {
  const plain = await run('plain', ['cache', 'clear', '--bogus']);
  const none = await run('none', ['cache', 'clear', '--bogus']);
  expect(plain.stderr).toBe(unknownBogus);
  expect(none.stderr).toBe(plain.stderr);
  expect(none.stdout).toBe(
    'hook:fixture/one:UnknownOptionError:[cache,clear]\nhook:fixture/two:UnknownOptionError:[cache,clear]\nresolved:2\n',
  );
});

test('a hook that throws ends the hooks: no later hook runs, no hint prints, and the run returns 1', async () => {
  await expect(run('broken-throws', ['cache', 'clear', '--bogus'])).resolves.toEqual({
    status: 1,
    stderr: `${unknownBogus}store: Something went wrong.\n`,
    stdout: 'hook:fixture/broken:UnknownOptionError:[cache,clear]\nresolved:1\n',
  });
  await expectBrokenHook('broken-throws', 'Cannot suggest.');
});

test.each([
  ['broken-multiline', String.raw`line one\u000aline two`],
  [
    'broken-controls',
    `red${['001b', '000d', '2028', '2029'].map((hex) => `\\u${hex}`).join('')}end`,
  ],
])(
  'a throwing hook whose reason holds a line break or a control character (%s) writes one line',
  async (scenario, reason) => {
    await expect(
      run(scenario, ['cache', 'clear', '--bogus']).then((fixtureResult) => fixtureResult.stderr),
    ).resolves.toBe(`${unknownBogus}store: Something went wrong.\n`);
    // The development build states the reason on one line, every control escaped.
    await expectBrokenHook(scenario, reason);
  },
);

test('a broken failure view whose reason holds a line break writes the generic line alone', async () => {
  await expect(
    run('broken-view-multiline', ['cache', 'clear', '--bogus']).then(
      (fixtureResult) => fixtureResult.stderr,
    ),
  ).resolves.toBe(`${unknownBogus}store: Something went wrong.\n`);
});

test('a throwing hook beside a view that would break writes the default text without hints, and the view never runs', async () => {
  const result = await run('broken-view', ['cache', 'clear', '--bogus']);
  expect(result.stderr).toBe(`${unknownBogus}store: Something went wrong.\n`);
  expect(result.stdout.split('\n').at(-2)).toBe('resolved:1');
});

test('a throwing hook in a cancelled run whose failure still renders returns 130 and writes its line', async () => {
  await expect(run('cancelled-broken')).resolves.toEqual({
    status: 130,
    stderr: 'The action failed.\nstore: Something went wrong.\n',
    stdout: 'hook:fixture/broken:FatalError:[]\nresolved:130\n',
  });
});

test('a cancelled run that reports its cancellation silently calls no hook', async () => {
  await expect(run('cancelled-silent')).resolves.toEqual({
    status: 130,
    stderr: '',
    stdout: 'resolved:130\n',
  });
});

test('a takeover of a held unknown-option fault calls no hook', async () => {
  await expect(run('takeover', ['cache', 'clear', '--bogus', '--help'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'help\nresolved:0\n',
  });
});

test.each([
  ['a variadic argument', ['tag', 'good', 'bad']],
  ['a multiple option', ['label', '--name', 'good', '--name', 'bad']],
])('an issue on the second value of %s keeps its own fields', async (_kind, argv) => {
  const result = await run('issue-fields', argv);
  expect(JSON.parse(result.stderr)).toEqual([
    { code: 'too_short', message: 'Too short.', path: [1] },
  ]);
});

test('a hook suggests a visible global or local spelling, never a hidden or deprecated one', async () => {
  await expect(
    run('candidates', ['cache', 'clear', '--bogus']).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toBe(`${unknownBogus}options: --file -f --keep -k\n`);
});

test('a hook suggests a visible child by its canonical name, never an alias', async () => {
  await expect(
    run('candidates', ['cache', 'nope']).then((fixtureResult) => fixtureResult.stderr),
  ).resolves.toBe(
    'store: Unknown command "nope". Use one of: clear, list.\nchildren: clear list\n',
  );
});
