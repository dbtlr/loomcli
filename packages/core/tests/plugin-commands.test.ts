import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for plugin Commands (docs/core/plugin-contract.md#plugin-commands).
 *
 * The acceptance is a core fixture application that installs plugins attaching a `doctor` Command.
 * It proves that `inspect()` lists the plugin Commands as the root's first children, in
 * installation and list order, and that they route and run like any other Command. It also proves
 * routing into a plugin group's children, a hook-declared option reaching a plugin Command from
 * another plugin's hook and from its own, and a declaration error when the application attaches a
 * Command with the same name, when two installed plugins attach one name, when an alias repeats a
 * sibling's name, when the application also attaches the plugin's Command value at the root or
 * under another Command, when a plugin Command's local option repeats a global option's
 * key, and when the root declares arguments. Each case runs under Node and Bun.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/plugins/commands.mjs', import.meta.url);

/** One invocation of the scenario's application with the given tokens. */
async function run(scenario: string, argv: string[] = []) {
  return await invokeFixture(fixture, [scenario, 'run', ...argv]);
}

/** The root's children as `inspect()` lists them, or the declaration fault a call threw. */
async function inspect(scenario: string) {
  return await invokeFixture(fixture, [scenario, 'inspect']).then(
    (fixtureResult) => fixtureResult.stdout,
  );
}

test("plugin Commands attach ahead of the application's, in installation and list order", async () => {
  await expect(inspect('order')).resolves.toBe('["alpha","beta","gamma","local"]\n');
});

test('a plugin Command routes and runs like any other Command', async () => {
  await expect(run('order', ['gamma'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'ran:gamma\nresolved:0\n',
  });
  await expect(run('order', ['local']).then((fixtureResult) => fixtureResult.stdout)).resolves.toBe(
    'ran:local\nresolved:0\n',
  );
});

test("a lifecycle hook runs over a plugin Command, which the action's options reflect", async () => {
  await expect(
    run('hooked', ['doctor', '--quiet']).then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe('quiet:true\nresolved:0\n');
});

test("a plugin's own hook runs over the Command that plugin attaches", async () => {
  await expect(
    run('own-hook', ['doctor', '--quiet']).then((fixtureResult) => fixtureResult.stdout),
  ).resolves.toBe('quiet:true\nresolved:0\n');
});

test('routing descends into the children of a group a plugin attaches', async () => {
  await expect(run('nested', ['tools', 'clear'])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'ran:clear\nresolved:0\n',
  });
});

/**
 * Every existing Command rule rejects a plugin Command where the root attaches it: `plugin()` for
 * its own list, the constructor for two plugins, and the application's own call otherwise.
 */
const rejected = [
  [
    'application-collision',
    'The root Command attaches two children named "doctor". Rename or remove one.',
  ],
  [
    'plugin-collision',
    'The root Command attaches two children named "doctor". Rename or remove one.',
  ],
  [
    'alias-collision',
    'The root Command attaches child "check" with alias "doctor", which is also the name of child "doctor". Rename or remove one.',
  ],
  [
    'same-value-in-plugins',
    'The root Command attaches two children named "doctor". Rename or remove one.',
  ],
  [
    'same-value-at-root',
    'The root Command attaches two children named "doctor". Rename or remove one.',
  ],
  [
    'same-value-nested',
    'Command "tools" attaches child "doctor", which the root Command also attaches. Attach a Command value at one point; create a new Command for each placement.',
  ],
  [
    'global-collision',
    'Option "quiet" is declared as a global option and as a local option on Command "doctor". Rename the local option.',
  ],
  [
    'root-arguments',
    'The root Command declares argument "files" and attaches child "doctor". Move the argument into a child Command or remove the children.',
  ],
  ['plugin-unfinished', 'Command "doctor" has no action. Register an action.'],
  [
    'plugin-repeated-name',
    'The root Command attaches two children named "doctor". Rename or remove one.',
  ],
] satisfies [string, string][];

test.each(rejected)(
  'the call that makes the %s declaration wrong throws',
  async (scenario, message) => {
    await expect(inspect(scenario)).resolves.toBe(`thrown:1: ${message}\n`);
  },
);

test("the plugins' Commands leave globalOption() open", async () => {
  await expect(inspect('global-after-plugin-commands')).resolves.toBe('["doctor","local"]\n');
});
