import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function views(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/views.mjs', import.meta.url), [scenario, ...argv]);
}

/** One invocation that wrote its whole result to stdout and reported no failure. */
function rendered(stdout: string) {
  return { status: 0, stderr: '', stdout };
}

/** One invocation a declaration rule rejected, which a distributed build reports generically. */
const rejected = { status: 1, stderr: 'views: Something went wrong.\n', stdout: 'resolved:1\n' };

test('a declared view with no override renders through its own default function', () => {
  expect(views('declared-default')).toEqual(rendered('page: one\nresolved:0\n'));
});

test("a plugin's override of the view it declares supersedes that default", () => {
  expect(views('plugin-override')).toEqual(rendered('plugin: one\nresolved:0\n'));
});

test('one key overridden by the application and by a plugin resolves to the application', () => {
  expect(views('shared-key')).toEqual(rendered('app: one\nresolved:0\n'));
});

test('one key overridden twice in one contributor resolves to the first override', () => {
  expect(views('app-duplicate-view')).toEqual(rendered('one: one\nresolved:0\n'));
});

test("a declared row view in a plugin's list resolves through its own default functions", () => {
  expect(views('row-declared')).toEqual(rendered('ROWS\n0: one\n1: two\nresolved:0\n'));
});

test('an override keyed by a declared row view supersedes its whole shape', () => {
  expect(views('row-override')).toEqual(rendered('app: one\napp: two\nresolved:0\n'));
});

test('an override for a view no installed plugin declares is inert', () => {
  expect(views('inert')).toEqual({
    status: 2,
    stderr: 'views: Option "--file" is required. Supply a value.\n',
    stdout: 'resolved:2\n',
  });
});

test('that same override applies the moment its view is rendered', () => {
  expect(views('inert-rendered')).toEqual(rendered('app: one\nresolved:0\n'));
});

test('a hand-built object with an identity field is a bare view and consults no override', () => {
  expect(views('bare-identity')).toEqual(rendered('forged: one\nresolved:0\n'));
});

test('an application override for UsageError beats a plugin override for InputError', () => {
  expect(views('usage-over-input')).toEqual({
    status: 2,
    stderr: 'app usage: Option "--file" is required. Supply a value.\n',
    stdout: 'resolved:2\n',
  });
});

test("an earlier plugin's UsageError override beats a later plugin's InputError override", () => {
  expect(views('plugins-order')).toEqual({
    status: 2,
    stderr: 'first usage: Option "--file" is required. Supply a value.\n',
    stdout: 'resolved:2\n',
  });
});

test("a build fault reaches the application's own overrides", () => {
  expect(views('build-fault')).toEqual({
    status: 1,
    stderr: 'app declaration: The root Command has no action. Register an action.\n',
    stdout: 'resolved:1\n',
  });
});

/** One declaration the call that made it rejected, before any view could render the fault. */
function thrown(message: string) {
  return { status: 0, stderr: '', stdout: `thrown:1: ${message}\n` };
}

test.each([
  [
    'global-name',
    'Option name "-file" is invalid. Use a nonempty name without a leading hyphen, whitespace, or "=".',
  ],
  [
    'shared-child',
    'Command "two" attaches child "shared", which Command "one" also attaches. Attach a Command value at one point; create a new Command for each placement.',
  ],
] satisfies [string, string][])(
  'the %s fault throws from its call, so no override renders it',
  (scenario, message) => {
    expect(views(scenario)).toEqual(thrown(message));
  },
);

test("a build fault does not consult a plugin's overrides", () => {
  expect(views('build-fault-unbranded')).toEqual(rejected);
});

test('an override of a lane view is observed through its semantic method with one newline', () => {
  expect(views('lane-warn')).toEqual({
    status: 0,
    stderr: 'warned: careful\n',
    stdout: 'resolved:0\n',
  });
});

test('a lane override that returns the empty string still writes the one newline', () => {
  expect(views('lane-empty')).toEqual({ status: 0, stderr: '\n', stdout: 'resolved:0\n' });
});

test('a broken lane view rejects its own call, which the action catches', () => {
  expect(views('lane-broken')).toEqual({ status: 0, stderr: '', stdout: 'caught\nresolved:0\n' });
});

test('a lane view rendered through out.render writes its message with no newline', () => {
  expect(views('lane-rendered')).toEqual(rendered('bareresolved:0\n'));
});

test('a failure the action raised stays primary, and an unawaited broken render reports after it', () => {
  expect(views('render-then-failure')).toEqual({
    status: 2,
    stderr: 'views: Option "--file" is required. Supply a value.\nviews: Something went wrong.\n',
    stdout: 'resolved:2\n',
  });
});

test.each([
  [
    'duplicate-identity',
    'View "@fixture/page" is declared by two distinct objects. Install one copy of the package that declares it.',
  ],
  [
    'duplicate-declaration',
    'View "@fixture/page" is declared by two distinct objects. Install one copy of the package that declares it.',
  ],
] satisfies [string, string][])(
  'the call that declares the %s views throws',
  (scenario, message) => {
    expect(views(scenario)).toEqual(thrown(message));
  },
);
