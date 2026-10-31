import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for the view registry (docs/core/views.md).
 *
 * The registry is proven when jsonkit's `FatalError` override produces the failure bytes that
 * examples/jsonkit/tests pins, and when an override of `helpPage` in a test application changes
 * `jsonkit --help` while `help()` stays installed. Each case runs under Node and Bun. The cases:
 *
 * - Resolution order. One application override and one plugin override for a shared key resolve to
 *   the application's. An application override for `UsageError` beside a plugin override for
 *   `InputError` resolves to the application's. An earlier plugin's `UsageError` override beside a
 *   later plugin's `InputError` override resolves to the earlier plugin's.
 * - Declared views. A declared-view key from a second copy of a package is rejected. An override
 *   for a view no plugin declares is inert.
 * - Lanes. An override of `lanes.warn` is observed through `out.warn` with one newline.
 * - Bare views. A hand-built object with an `identity` field renders as a bare view.
 * - Markers. A help page and a version line whose graph facts carry marker characters print them
 *   literally.
 * - Build rules. Each build rule the reference lists.
 * - Broken views. A broken lane view, a broken `helpPage` override under `jsonkit --help` returning
 *   1 with one diagnostic on stderr, an action that throws an `InputError` after an unawaited
 *   broken `out.render` returning 2 with one diagnostic, and a broken failure view under the
 *   fallback path.
 * - Type checks. The negative type checks cover the invariance cases, a replacement that requires
 *   data the key lacks and a declared view reassigned to another data type, and the retired
 *   `Renderer` cases moved to `View`.
 */

import { invoke as invokeFixture } from './run-fixture.ts';

async function views(scenario: string, argv: string[] = []) {
  return await invokeFixture(new URL('fixtures/views.mjs', import.meta.url), [scenario, ...argv]);
}

/** One invocation that wrote its whole result to stdout and reported no failure. */
function rendered(stdout: string) {
  return { status: 0, stderr: '', stdout };
}

/** One invocation a declaration rule rejected, which a distributed build reports generically. */
const rejected = { status: 1, stderr: 'views: Something went wrong.\n', stdout: 'resolved:1\n' };

test('a declared view with no override renders through its own default function', async () => {
  await expect(views('declared-default')).resolves.toEqual(rendered('page: one\nresolved:0\n'));
});

test("a plugin's override of the view it declares supersedes that default", async () => {
  await expect(views('plugin-override')).resolves.toEqual(rendered('plugin: one\nresolved:0\n'));
});

test('one key overridden by the application and by a plugin resolves to the application', async () => {
  await expect(views('shared-key')).resolves.toEqual(rendered('app: one\nresolved:0\n'));
});

test('one key overridden twice in one contributor resolves to the first override', async () => {
  await expect(views('app-duplicate-view')).resolves.toEqual(rendered('one: one\nresolved:0\n'));
});

test("a declared row view in a plugin's list resolves through its own default functions", async () => {
  await expect(views('row-declared')).resolves.toEqual(
    rendered('ROWS\n0: one\n1: two\nresolved:0\n'),
  );
});

test('an override keyed by a declared row view supersedes its whole shape', async () => {
  await expect(views('row-override')).resolves.toEqual(
    rendered('app: one\napp: two\nresolved:0\n'),
  );
});

test('an override for a view no installed plugin declares is inert', async () => {
  await expect(views('inert')).resolves.toEqual({
    status: 2,
    stderr: 'views: Option "--file" is required. Supply a value.\n',
    stdout: 'resolved:2\n',
  });
});

test('that same override applies the moment its view is rendered', async () => {
  await expect(views('inert-rendered')).resolves.toEqual(rendered('app: one\nresolved:0\n'));
});

test('a hand-built object with an identity field is a bare view and consults no override', async () => {
  await expect(views('bare-identity')).resolves.toEqual(rendered('forged: one\nresolved:0\n'));
});

test('an application override for UsageError beats a plugin override for InputError', async () => {
  await expect(views('usage-over-input')).resolves.toEqual({
    status: 2,
    stderr: 'app usage: Option "--file" is required. Supply a value.\n',
    stdout: 'resolved:2\n',
  });
});

test("an earlier plugin's UsageError override beats a later plugin's InputError override", async () => {
  await expect(views('plugins-order')).resolves.toEqual({
    status: 2,
    stderr: 'first usage: Option "--file" is required. Supply a value.\n',
    stdout: 'resolved:2\n',
  });
});

test("a build fault reaches the application's own overrides", async () => {
  await expect(views('build-fault')).resolves.toEqual({
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
  async (scenario, message) => {
    await expect(views(scenario)).resolves.toEqual(thrown(message));
  },
);

test("a build fault does not consult a plugin's overrides", async () => {
  await expect(views('build-fault-unbranded')).resolves.toEqual(rejected);
});

test('an override of a lane view is observed through its semantic method with one newline', async () => {
  await expect(views('lane-warn')).resolves.toEqual({
    status: 0,
    stderr: 'warned: careful\n',
    stdout: 'resolved:0\n',
  });
});

test('a lane override that returns the empty string still writes the one newline', async () => {
  await expect(views('lane-empty')).resolves.toEqual({
    status: 0,
    stderr: '\n',
    stdout: 'resolved:0\n',
  });
});

test('a broken lane view rejects its own call, which the action catches', async () => {
  await expect(views('lane-broken')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'caught\nresolved:0\n',
  });
});

test('a lane view rendered through out.render writes its message with no newline', async () => {
  await expect(views('lane-rendered')).resolves.toEqual(rendered('bareresolved:0\n'));
});

test('a failure the action raised stays primary, and an unawaited broken render reports after it', async () => {
  await expect(views('render-then-failure')).resolves.toEqual({
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
  async (scenario, message) => {
    await expect(views(scenario)).resolves.toEqual(thrown(message));
  },
);
