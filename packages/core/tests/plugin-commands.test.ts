import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/commands.mjs', import.meta.url);

/** One invocation of the scenario's application with the given tokens. */
function run(scenario: string, argv: string[] = []) {
  return invoke(fixture, [scenario, 'run', ...argv]);
}

/** The root's children as `inspect()` lists them, or the declaration error build raised. */
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

/** Every existing Command rule rejects a plugin Command where the root attaches it. */
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
    'same-value-at-root',
    'The root Command attaches two children named "doctor". Rename or remove one.',
  ],
  [
    'same-value-nested',
    'Command "tools" attaches child "doctor", which the root Command also attaches. Attach a Command value at one point; create a new Command for each placement.',
  ],
  [
    'root-arguments',
    'The root Command declares argument "files" and attaches child "doctor". Move the argument into a child Command or remove the children.',
  ],
] satisfies [string, string][];

test.each(rejected)('build rejects the %s declaration', (scenario, message) => {
  expect(inspect(scenario)).toBe(`declaration:1: ${message}\n`);
  expect(run(scenario)).toEqual({
    status: 1,
    stderr: `Invalid declaration: ${message}\n`,
    stdout: 'resolved:1\n',
  });
});
