import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/commands.mjs', import.meta.url);

/** One invocation of the scenario's application with the given tokens. */
function run(scenario: string, argv: string[] = []) {
  return invoke(fixture, [scenario, 'run', ...argv]);
}

/** The root's children as `inspect()` lists them, or the declaration fault a call threw. */
function inspect(scenario: string) {
  return invoke(fixture, [scenario, 'inspect']).stdout;
}

test("plugin Commands attach ahead of the application's, in installation and list order", () => {
  expect(inspect('order')).toBe('["alpha","beta","gamma","local"]\n');
});

test('a plugin Command routes and runs like any other Command', () => {
  expect(run('order', ['gamma'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'ran:gamma\nresolved:0\n',
  });
  expect(run('order', ['local']).stdout).toBe('ran:local\nresolved:0\n');
});

test("a lifecycle hook runs over a plugin Command, which the action's options reflect", () => {
  expect(run('hooked', ['doctor', '--quiet']).stdout).toBe('quiet:true\nresolved:0\n');
});

test("a plugin's own hook runs over the Command that plugin attaches", () => {
  expect(run('own-hook', ['doctor', '--quiet']).stdout).toBe('quiet:true\nresolved:0\n');
});

test('routing descends into the children of a group a plugin attaches', () => {
  expect(run('nested', ['tools', 'clear'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'ran:clear\nresolved:0\n',
  });
});

/**
 * Every existing Command rule rejects a plugin Command where the root attaches it: the constructor
 * for two plugins, and the application's own call otherwise.
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
    'global-after-command',
    'The Application declares global option "file" after command() or action(). Declare global options before attaching Commands or registering an action.',
  ],
  [
    'root-arguments',
    'The root Command declares argument "files" and attaches child "doctor". Move the argument into a child Command or remove the children.',
  ],
] satisfies [string, string][];

test.each(rejected)('the call that makes the %s declaration wrong throws', (scenario, message) => {
  expect(inspect(scenario)).toBe(`thrown:1: ${message}\n`);
});

test("the plugins' Commands leave globalOption() open", () => {
  expect(inspect('global-after-plugin-commands')).toBe('["doctor","local"]\n');
});
