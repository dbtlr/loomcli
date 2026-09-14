import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function views(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/views.mjs', import.meta.url), [scenario, ...argv]);
}

/** One invocation that wrote its whole result to stdout and reported no failure. */
function rendered(stdout: string) {
  return { status: 0, stderr: '', stdout };
}

/** One invocation a declaration rule rejected, which reports on stderr and resolves 1. */
function rejected(message: string) {
  return { status: 1, stderr: `Invalid declaration: ${message}\n`, stdout: 'resolved:1\n' };
}

test('a declared view with no override renders through its own default function', () => {
  expect(views('declared-default')).toEqual(rendered('page: one\nresolved:0\n'));
});

test("a plugin's override of the view it declares supersedes that default", () => {
  expect(views('plugin-override')).toEqual(rendered('plugin: one\nresolved:0\n'));
});

test('one key overridden by the application and by a plugin resolves to the application', () => {
  expect(views('shared-key')).toEqual(rendered('app: one\nresolved:0\n'));
});

test('an override for a view no installed plugin declares is inert', () => {
  expect(views('inert')).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--file" is required. Supply a value.\n',
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
    stderr:
      'app declaration: Plugin "@fixture/twice" overrides the view for "InputError" twice. Remove one override.\n',
    stdout: 'resolved:1\n',
  });
});

test("a build fault does not consult a plugin's overrides", () => {
  expect(views('build-fault-unbranded')).toEqual(
    rejected(
      'Plugin "@fixture/twice" overrides the view for "InputError" twice. Remove one override.',
    ),
  );
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

test('a broken lane view rejects its own call and ends the invocation', () => {
  expect(views('lane-broken')).toEqual({
    status: 1,
    stderr: 'Internal error: Rendering output failed: Cannot render the view.\n',
    stdout: 'caught\nresolved:1\n',
  });
});

test('a lane view rendered through out.render writes its message with no newline', () => {
  expect(views('lane-rendered')).toEqual(rendered('bareresolved:0\n'));
});

test('a failure the action raised stays primary over an unawaited broken render', () => {
  expect(views('render-then-failure')).toEqual({
    status: 2,
    stderr: 'Invalid input: Option "--file" is required. Supply a value.\n',
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
  [
    'app-duplicate-view',
    'The Application overrides view "@fixture/page" twice. Remove one override.',
  ],
  [
    'plugin-duplicate-view',
    'Plugin "@fixture/pages" overrides view "@fixture/page" twice. Remove one override.',
  ],
  [
    'app-declares',
    'The Application holds a value that is not a view override. Supply the value returned by override(key, view).',
  ],
  [
    'plugin-foreign',
    'Plugin "@fixture/pages" holds a value that is not a view. Supply the value returned by view(identity, definition) or override(key, view).',
  ],
  [
    'retired',
    'The Application options contain failures. Declare view overrides under views with override(key, view).',
  ],
] satisfies [string, string][])('build rejects the %s declaration', (scenario, message) => {
  expect(views(scenario)).toEqual(rejected(message));
});
