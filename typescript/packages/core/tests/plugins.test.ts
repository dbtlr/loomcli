import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, plugin } from '../src/index.js';
import { invoke as invokeFixture } from './run-fixture.ts';

/**
 * One plugin declaration scenario. A fault a call can judge throws from that call, and a build fault
 * answers in `inspect()` and in `run()` alike, where `run()` returns 1.
 */
async function build(scenario: string, mode: 'inspect' | 'rule' | 'run') {
  return await invokeFixture(new URL('fixtures/plugins/build.mjs', import.meta.url), [
    scenario,
    mode,
  ]);
}

/**
 * Every row of the plugin declaration errors that a call can judge. `plugin()` checks one
 * definition, and `new Application()` checks the installed set, so each throws from the call.
 */
const thrown = [
  [
    'installed-twice',
    'The Application installs plugin "@loomcli/help" twice. Install each plugin once.',
  ],
  [
    'option-global-key',
    'Option "help" is declared by plugin "@loomcli/help" and as a global option. Rename one declaration.',
  ],
  [
    'local-key',
    'Option "help" is declared by plugin "@loomcli/help" and as a local option on Command "get". Rename the local option.',
  ],
  [
    'two-plugin-keys',
    'Option "verbose" is declared by plugin "@loomcli/log" and plugin "@acme/trace". Install one of them or rename the option.',
  ],
  [
    'option-spelling',
    'Option spelling "-h" is used by plugin "@loomcli/help" option "help" and the global option "host". Change one declaration.',
  ],
  [
    'twin-descriptors',
    'Extension "@fixture/facts/command" is defined twice. Install one copy of the package that defines it.',
  ],
  [
    'invalid-value',
    'Command "get" holds an invalid "@fixture/facts/command" value: Invalid input: expected string, received number. Correct the value.',
  ],
  [
    'async-schema',
    'The root Command holds a "@fixture/async" value its schema did not answer synchronously. Supply a schema that answers synchronously.',
  ],
  [
    'exotic-output',
    'Extension "@fixture/exotic" produced a value that is not plain data on Command "get". Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'schema-throws',
    'The root Command holds an invalid "@fixture/schema/throws" value: the schema threw. Correct the value.',
  ],
  [
    'schema-silent',
    'The root Command holds an invalid "@fixture/schema/silent" value: The schema rejected this value without an explanation. Correct the value.',
  ],
  [
    'schema-sentence',
    'The root Command holds an invalid "@fixture/schema/sentence" value: Supply one word. Correct the value.',
  ],
  [
    'output-symbol',
    'Extension "@fixture/output/symbol" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-accessor',
    'Extension "@fixture/output/accessor" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-hidden',
    'Extension "@fixture/output/hidden" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-nan',
    'Extension "@fixture/output/nan" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-infinite',
    'Extension "@fixture/output/infinite" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-sparse',
    'Extension "@fixture/output/sparse" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
  [
    'output-cycle',
    'Extension "@fixture/output/cycle" produced a value that is not plain data on the root Command. Return strings, numbers, booleans, null, arrays, and plain objects.',
  ],
] satisfies [string, string][];

test.each(thrown)('the call that declares the %s fault throws it', async (scenario, message) => {
  await expect(build(scenario, 'inspect')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `thrown:1: ${message}\n`,
  });
});

/** Every row that a lifecycle hook raises, which only the graph build can know. */
const rejected = [
  [
    'hook-throws',
    'Plugin "@loomcli/plugins/format" failed in onCommandAttach for Command "count": the hook broke. Return the value the hook received or a value derived from it, and throw only a DeclarationError from the hook.',
  ],
  [
    'hook-throws-declaration',
    'Plugin "@loomcli/plugins/format" requires a result on Command "count". Declare one or omit the plugin.',
  ],
  [
    'hook-local-collision',
    'Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as a local option. Rename the Command\'s option or omit the plugin.',
  ],
  [
    'hook-global-collision',
    'Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as a global option. Rename the global option or omit the plugin.',
  ],
  [
    'hook-plugin-collision',
    'Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as an option of plugin "@acme/out". Install one of them.',
  ],
  [
    'hook-hook-collision',
    'Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as an option plugin "@acme/out" declared through onCommandAttach. Install one of them.',
  ],
  [
    'hook-argument-collision',
    'Plugin "@loomcli/plugins/format" declares option "format" on Command "count", which is already declared as an argument. Rename the Command\'s argument or omit the plugin.',
  ],
  [
    'hook-argument-author-collision',
    'Plugin "@loomcli/plugins/format" declares argument "tag" on Command "count", which is already declared as an argument. Rename the Command\'s argument or omit the plugin.',
  ],
  [
    'hook-argument-local-collision',
    'Plugin "@loomcli/plugins/format" declares argument "tag" on Command "count", which is already declared as a local option. Rename the Command\'s option or omit the plugin.',
  ],
  [
    'hook-argument-global-collision',
    'Plugin "@loomcli/plugins/format" declares argument "tag" on Command "count", which is already declared as a global option. Rename the global option or omit the plugin.',
  ],
  [
    'hook-argument-plugin-collision',
    'Plugin "@loomcli/plugins/format" declares argument "tag" on Command "count", which is already declared as an option of plugin "@acme/out". Install one of them.',
  ],
  [
    'hook-argument-hook-option-collision',
    'Plugin "@loomcli/plugins/format" declares argument "tag" on Command "count", which is already declared as an option plugin "@acme/out" declared through onCommandAttach. Install one of them.',
  ],
  [
    'hook-argument-hook-collision',
    'Plugin "@loomcli/plugins/format" declares argument "tag" on Command "count", which is already declared as an argument plugin "@acme/out" declared through onCommandAttach. Install one of them.',
  ],
  [
    'hook-spelling-collision',
    'Plugin "@loomcli/plugins/format" declares option "format" with spelling "-f" on Command "count", which "--file" already uses. Change one of the two spellings or omit the plugin.',
  ],
] satisfies [string, string][];

test.each(rejected)(
  'inspect() and run() reject the %s declaration alike',
  async (scenario, message) => {
    await expect(build(scenario, 'inspect')).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: `declaration:1: ${message}\n`,
    });
    await expect(build(scenario, 'run')).resolves.toEqual({
      status: 1,
      stderr: `app: Something went wrong.\n`,
      stdout: 'resolved:1\n',
    });
  },
);

/**
 * The reason rule each hook collision breaks.
 * A key two options share, a name two arguments share, or a spelling two options share breaks the
 * rule the application's own collision of that pair breaks.
 * A name an argument and an option share breaks name-shared-across-kinds, which only a hook reaches.
 */
const hookCollisionRules = [
  ['hook-local-collision', 'option-declared-twice'],
  ['hook-global-collision', 'option-declared-twice'],
  ['hook-plugin-collision', 'option-declared-twice'],
  ['hook-hook-collision', 'option-declared-twice'],
  ['hook-argument-author-collision', 'argument-declared-twice'],
  ['hook-argument-hook-collision', 'argument-declared-twice'],
  ['hook-argument-collision', 'name-shared-across-kinds'],
  ['hook-argument-local-collision', 'name-shared-across-kinds'],
  ['hook-argument-global-collision', 'name-shared-across-kinds'],
  ['hook-argument-plugin-collision', 'name-shared-across-kinds'],
  ['hook-argument-hook-option-collision', 'name-shared-across-kinds'],
  ['hook-spelling-collision', 'spelling-taken'],
] satisfies [string, string][];

test.each(hookCollisionRules)('the %s fault reports under %s', async (scenario, rule) => {
  await expect(build(scenario, 'rule')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: `@loomcli/core/${rule}\n`,
  });
});

/** The same graph under the views one scenario's contributors contributed. */
async function rendered(scenario: string, argv: string[], env: Record<string, string> = {}) {
  return await invokeFixture(
    new URL('fixtures/plugins/invoke.mjs', import.meta.url),
    [scenario, 'run', ...argv],
    { env },
  );
}

test("a plugin's failure views answer the classes the application leaves to them", async () => {
  await expect(rendered('failures', ['get'])).resolves.toEqual({
    status: 2,
    stderr: 'plugin input: Argument "path" requires a value. Supply a value for "path".\n',
    stdout: 'resolved:2\n',
  });
  await expect(
    rendered('failures', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' }),
  ).resolves.toEqual({
    status: 1,
    stderr: 'plugin fatal: the action stopped the invocation\n',
    stdout: 'resolved:1\n',
  });
});

test('one class overridden by the application and by a plugin resolves first-in-wins', async () => {
  await expect(rendered('failures-both', ['get'])).resolves.toEqual({
    status: 2,
    stderr: 'app input: Argument "path" requires a value. Supply a value for "path".\n',
    stdout: 'resolved:2\n',
  });
  // The plugin still answers the class the application left to it.
  await expect(
    rendered('failures-both', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' }),
  ).resolves.toEqual({
    status: 1,
    stderr: 'plugin fatal: the action stopped the invocation\n',
    stdout: 'resolved:1\n',
  });
});

test('a hook declares an option after the action, which the closures do not close', async () => {
  await expect(build('hook-late-option', 'inspect')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'inspected\n',
  });
});

test('an alias of an option a hook declares binds that option', async () => {
  const received: unknown[] = [];
  const app = new Application('app', {
    plugins: [
      plugin('@acme/format', {
        onCommandAttach: (command) =>
          command.name === 'count'
            ? command.option('shape', { aliases: ['form'], type: 'string' })
            : command,
      }),
    ],
  }).command(
    new Command('count').action((context) => {
      received.push(context.options);
    }),
  );
  const mock = mockProcess({ argv: ['count', '--form', 'round'] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toBe('');
  expect(received).toEqual([{ shape: 'round' }]);
});

test('a plugin that declares nothing installs and costs the invocation nothing', async () => {
  await expect(build('installed', 'inspect')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'inspected\n',
  });
  await expect(build('installed', 'run')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'dispatched\nresolved:0\n',
  });
});
