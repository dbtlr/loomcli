import { spawnSync } from 'node:child_process';
/*
 * Acceptance plan for core's log events (docs/core/logging.md#logging).
 *
 * Core's log events are proven when public APIs alone, with fixture applications and a fixture
 * plugin whose `onLog` collects events, produce these results under Node and Bun:
 *
 * - Reach. An action, a middleware, a configuration source, and an `onFailure` hook each log one
 *   event, which the collector receives in call order: the middleware's, source's, and hook's name
 *   the fixture plugin, and the action's, a plugin Command's action included, read `null`. The
 *   negative type checks find no `log` in `onCommandAttach` or `onGraphBuilt`.
 * - The copy. Fields holding a `Date`, an `Error` with a `cause`, a `bigint`, an object that holds
 *   itself, `undefined`, a function, an array holding `undefined`, `NaN`, and a class instance each
 *   read their pinned JSON; changing the caller's object after the call leaves the event unchanged,
 *   and writing to the event throws in strict mode.
 * - Facts. `time` matches the ISO 8601 UTC form with milliseconds. `run` is 32 lowercase hex
 *   characters, equal across one run's events, and different across two runs, an action's `invoke`,
 *   and an `app.invoke`. `path` reads `[]` for a structural fault before routing, the partial path
 *   for an unknown Command under a group, and the routed path in an action. `application` reads the
 *   graph's name and version, and `0.0.0` for an Application that declares none.
 * - Failure events. An `InputError` logs at `error` with its form, exit code 2. An action that
 *   throws a `TypeError` logs at `fatal` with `defect` holding its name, message, and stack from
 *   source and from a bundle, while the bundle's stderr holds the generic defect message alone. A
 *   fault reported after the outcome logs its own event, a stdout that fails a write logs its
 *   `@loomcli/core/broken-destination` defect at `fatal` with the write error as `defect`, and a
 *   failed action `invoke` logs its failure event. A run a caller cancels whose action rejects with
 *   the signal's reason logs no failure event, a failure a cancelled run still renders logs one,
 *   and a build fault logs none.
 * - No listener. With no plugin that declares `onLog`, a call returns `undefined` and a getter on
 *   its fields is never read.
 * - Types. The negative type checks reject `log.fatal`, and the positive checks accept fields
 *   holding a `Date`, a `bigint`, `undefined`, an `Error`, a class instance, and a value of an
 *   interface type.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/logging.mjs', import.meta.url);

/** One event the fixture's collector received, and whether core froze it whole. */
interface Collected {
  event: {
    time: string;
    level: string;
    message: string;
    fields: Record<string, unknown>;
    application: { name: string; version: string };
    run: string;
    path: string[];
    plugin: string | null;
    failure?: { code: string; exitCode: number; message: string; hints: string[] };
    defect?: { name: string; message: string; stack?: string };
  };
  frozen: boolean;
  marker?: string;
}

/** What one process wrote, with the fixture's `event:` and `print:` lines read apart. */
function read(result: { status: number | null | undefined; stderr: string; stdout: string }) {
  const lines = result.stdout.split('\n');
  const events: Collected[] = lines
    .filter((line) => line.startsWith('event:'))
    .map((line) => JSON.parse(line.slice('event:'.length)));
  const printed: Record<string, unknown>[] = lines
    .filter((line) => line.startsWith('print:'))
    .map((line) => JSON.parse(line.slice('print:'.length)));
  const resolved = lines.find((line) => line.startsWith('resolved:'));
  return { events, printed, resolved, status: result.status, stderr: result.stderr };
}

/** The one item a list must hold. */
function only<Item>(items: readonly Item[]): Item {
  expect(items).toHaveLength(1);
  const [item] = items;
  if (item === undefined) {
    throw new Error('The list holds no item.');
  }
  return item;
}

async function run(scenario: string, argv: string[] = [], env: Record<string, string> = {}) {
  return read(
    await invokeFixture(fixture, [scenario, ...argv], {
      env: { FIXTURE_BUILD: 'distributed', ...env },
    }),
  );
}

/** The events of a run, with the identity of each reduced to what a test compares. */
async function summary(scenario: string, argv: string[] = [], env: Record<string, string> = {}) {
  return await run(scenario, argv, env).then((fixtureResult) =>
    fixtureResult.events.map(({ event }) => [event.level, event.message, event.plugin]),
  );
}

/** The script that bundles a fixture with `Bun.build` and a define, as `loom build` does. */
const bundler = fileURLToPath(new URL('fixtures/release/bundle.mjs', import.meta.url));

const root = mkdtempSync(join(tmpdir(), 'loom-logging-'));

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const traceId = /^[0-9a-f]{32}$/u;

test('an action, a middleware, a source, and an onFailure hook each log one event in call order', async () => {
  await expect(summary('reach')).resolves.toEqual([
    ['info', 'from source', 'fixture/reaching'],
    ['info', 'from middleware', 'fixture/reaching'],
    ['info', 'from action', null],
    ['info', 'from hook', 'fixture/reaching'],
    ['error', 'The action failed.', null],
  ]);
});

test("a plugin Command's action logs under no plugin", async () => {
  await expect(summary('reach', ['plug'])).resolves.toEqual([
    ['info', 'from source', 'fixture/reaching'],
    ['info', 'from middleware', 'fixture/reaching'],
    ['info', 'from plugin command', null],
  ]);
});

test('a call returns undefined and delivers a frozen event, whose methods keep working detached', async () => {
  const basic = await run('basic');
  expect(basic.printed).toEqual([{}]);
  expect(basic.events).toHaveLength(1);
  expect(basic.events[0]?.frozen).toBe(true);
  expect(basic.events[0]?.event).toMatchObject({
    fields: { count: 1 },
    level: 'info',
    message: 'hello',
    plugin: null,
  });
  await expect(summary('detached')).resolves.toEqual([['info', 'detached', null]]);
});

test('the five levels log in call order and the log has no fatal', async () => {
  const levels = await run('levels');
  expect(levels.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['trace', 'trace message'],
    ['debug', 'debug message'],
    ['info', 'info message'],
    ['warn', 'warn message'],
    ['error', 'error message'],
  ]);
  expect(levels.printed).toEqual([{ fatal: 'undefined' }]);
});

test('omitted fields read {}', async () => {
  await expect(
    run('empty-fields')
      .then((fixtureResult) => fixtureResult.events)
      .then((fixtureResult) => fixtureResult[0]?.event.fields),
  ).resolves.toEqual({});
});

test('fields copy into the JSON data JSON.stringify produces, with the three differences', async () => {
  const collected = only(await run('copy').then((fixtureResult) => fixtureResult.events));
  expect(collected.frozen).toBe(true);
  const { fields } = collected.event;
  expect(fields).toMatchObject({
    array: [null, null, null, null, 'kept'],
    bigint: '10',
    circular: { name: 'loop', self: '[Circular]' },
    date: '1970-01-01T00:00:00.000Z',
    infinite: null,
    instance: { across: 1, down: 2 },
    json: { replaced: true },
    map: {},
    nested: { value: 1 },
    shared: [{ value: 1 }, { value: 1 }],
  });
  expect(Object.keys(fields)).not.toContain('fn');
  expect(Object.keys(fields)).not.toContain('nothing');
  expect(Object.keys(fields)).not.toContain('symbol');
  expect(fields.error).toMatchObject({
    cause: { message: 'inner', name: 'TypeError', stack: expect.any(String) },
    message: 'outer',
    name: 'Error',
    stack: expect.any(String),
  });
});

test("a caller's change to the object after the call leaves the event unchanged", async () => {
  await expect(
    run('changed')
      .then((fixtureResult) => fixtureResult.events)
      .then((fixtureResult) => fixtureResult[0]?.event.fields),
  ).resolves.toEqual({
    count: 1,
    nested: { value: 1 },
  });
});

test('time, run, and application are read at the call in the pinned forms', async () => {
  const [collected] = await run('version').then((fixtureResult) => fixtureResult.events);
  expect(collected?.event.time).toMatch(isoTime);
  expect(collected?.event.run).toMatch(traceId);
  expect(collected?.event.application).toEqual({ name: 'probe', version: '1.2.3' });
  await expect(
    run('unversioned')
      .then((fixtureResult) => fixtureResult.events)
      .then((fixtureResult) => fixtureResult[0]?.event.application),
  ).resolves.toEqual({
    name: 'probe',
    version: '0.0.0',
  });
});

test('run is equal across one run, and different for the run, an action invoke, and app.invoke', async () => {
  const { events } = await run('runs');
  const [outer, inner, again] = events.slice(0, 3).map(({ event }) => event);
  const byName = events.filter(({ marker }) => marker === undefined);
  expect(byName.map(({ event }) => event.message)).toEqual([
    'outer',
    'inner',
    'outer again',
    'inner',
  ]);
  expect(outer?.run).toBe(again?.run);
  expect(inner?.run).not.toBe(outer?.run);
  const named = byName.at(-1)?.event;
  expect(named?.run).toMatch(traceId);
  expect(named?.run).not.toBe(outer?.run);
  expect(named?.run).not.toBe(inner?.run);
  await expect(
    run('runs')
      .then((fixtureResult) => fixtureResult.events)
      .then((fixtureResult) => fixtureResult[0]?.event.run),
  ).resolves.not.toBe(outer?.run);
});

test('path reads empty before routing, partial for an unknown Command, and routed in an action', async () => {
  const routed = await run('path-routed', ['cache', 'clear']).then(
    (fixtureResult) => fixtureResult.events,
  );
  expect(routed.map(({ event }) => event.path)).toEqual([['cache', 'clear']]);
  const structural = await run('path-routed', ['--file']).then(
    (fixtureResult) => fixtureResult.events,
  );
  expect(structural.map(({ event }) => [event.level, event.path])).toEqual([['error', []]]);
  const unknown = await run('path-routed', ['cache', 'nope']).then(
    (fixtureResult) => fixtureResult.events,
  );
  expect(unknown.map(({ event }) => [event.level, event.path])).toEqual([['error', ['cache']]]);
});

test('an InputError logs at error with its failure form and exit code 2', async () => {
  const result = await run('input-error', ['--bogus']);
  expect(result.resolved).toBe('resolved:2');
  const { event, frozen } = only(result.events);
  expect(frozen).toBe(true);
  expect(event.level).toBe('error');
  expect(event.plugin).toBeNull();
  expect(event.failure).toEqual({
    code: 'unknown-option',
    exitCode: 2,
    hints: [],
    message:
      'Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".',
  });
  expect(event.message).toBe(event.failure?.message);
  expect(event.defect).toBeUndefined();
});

test('a TypeError logs at fatal with its name, message, and stack from source', async () => {
  const result = await run('type-error', [], { FIXTURE_BUILD: 'development' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.defect).toEqual({
    message: 'The probe failed.',
    name: 'TypeError',
    stack: expect.stringContaining('TypeError: The probe failed.'),
  });
  expect(event.failure).toMatchObject({ code: 'internal', exitCode: 1 });
  expect(result.stderr).toContain('The probe failed.');
});

test('a distributed build logs the defect with its stack while stderr holds the generic sentence', async () => {
  const result = await run('type-error', [], { FIXTURE_BUILD: 'distributed' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.message).toBe('Something went wrong.');
  expect(event.failure?.message).toBe('Something went wrong.');
  expect(event.defect?.name).toBe('TypeError');
  expect(event.defect?.message).toBe('The probe failed.');
  expect(event.defect?.stack).toContain('The probe failed.');
  expect(result.stderr).toBe('probe: Something went wrong.\n');
});

test('a thrown string logs the value as the defect message, with no core stack', async () => {
  const result = await run('throw-string', [], { FIXTURE_BUILD: 'distributed' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.defect).toEqual({ message: "'boom'", name: 'InternalError' });
  expect(event.defect).not.toHaveProperty('stack');
});

test('a defect without a thrown Error cause reads the failure itself', async () => {
  const result = await run('internal-error', [], { FIXTURE_BUILD: 'distributed' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.defect).toMatchObject({
    message: 'The action reported a defect.',
    name: 'InternalError',
  });
});

test('a stdout that fails a write logs the destination defect at fatal with the write error', async () => {
  const result = await run('stdout-broken', [], { FIXTURE_BUILD: 'development' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.message).toBe('Could not write invocation output.');
  expect(event.defect).toEqual({
    message: 'write ENOSPC',
    name: 'Error',
    stack: expect.stringContaining('write ENOSPC'),
  });
  expect(event.failure).toMatchObject({ code: 'internal', exitCode: 1 });
  expect(result.resolved).toBe('resolved:1');
});

test('a distributed build logs the destination defect while stderr holds the generic sentence', async () => {
  const result = await run('stdout-broken', [], { FIXTURE_BUILD: 'distributed' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.message).toBe('Something went wrong.');
  expect(event.defect?.message).toBe('write ENOSPC');
  expect(result.stderr).toBe('probe: Something went wrong.\n');
});

test('a run whose stdout failed before its own failure logs the destination defect alone', async () => {
  // A run whose output failed reports no other failure, so the action's own logs no event.
  await expect(summary('stdout-broken-after-failure')).resolves.toEqual([
    ['fatal', 'Something went wrong.', null],
  ]);
});

test('a fault reported after the outcome logs its own event', async () => {
  const result = await run('after-primary', [], { FIXTURE_BUILD: 'distributed' });
  expect(result.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['error', 'The action failed.'],
    ['fatal', 'Something went wrong.'],
  ]);
  expect(result.events[1]?.event.defect?.message).toContain('The view broke.');
});

test('a failed action invoke logs its failure event under the nested run', async () => {
  const result = await run('invoke-failure');
  expect(result.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['error', 'The inner failed.'],
    ['info', 'after inner'],
  ]);
  const [inner, after] = result.events.map(({ event }) => event);
  expect(inner?.run).not.toBe(after?.run);
  expect(result.printed).toEqual([{ inner: 'failed' }]);
});

test('a cancelled run whose action rejects with the signal reason logs no failure event', async () => {
  const result = await run('cancelled-silent');
  expect(result.resolved).toBe('resolved:130');
  expect(result.events).toEqual([]);
});

test('a failure a cancelled run still renders logs one event, and the run keeps 130', async () => {
  const result = await run('cancelled-rendered');
  expect(result.resolved).toBe('resolved:130');
  expect(result.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['error', 'The action failed.'],
  ]);
});

test('a build fault logs no event', async () => {
  const result = await run('build-fault');
  expect(result.status).toBe(1);
  expect(result.events).toEqual([]);
});

test('with no plugin that declares onLog, a call returns undefined and a getter is never read', async () => {
  await expect(run('unlogged').then((fixtureResult) => fixtureResult.printed)).resolves.toEqual([
    { reads: 0, returned: true },
  ]);
  await expect(run('listened').then((fixtureResult) => fixtureResult.printed)).resolves.toEqual([
    { reads: 1 },
  ]);
});

/** Bundles the logging fixture, then runs one scenario of the bundle under a runtime. */
function bundledRun(runtime: string, scenario: string) {
  const outdir = join(root, `${runtime}-${scenario}`);
  const built = spawnSync(
    'bun',
    [bundler, 'logging-process.mjs', outdir, JSON.stringify({ build: 'distributed' })],
    { encoding: 'utf8', timeout: 60_000 },
  );
  expect(built.stderr).toBe('');
  expect(built.status).toBe(0);
  return read(
    spawnSync(runtime, [join(outdir, 'logging-process.js'), scenario], {
      encoding: 'utf8',
      timeout: 60_000,
    }),
  );
}

test.each(['node', 'bun'])(
  'a distributed bundle run under %s logs the defect at fatal with its stack and writes the generic sentence',
  (runtime) => {
    const result = bundledRun(runtime, 'type-error');
    const { event } = only(result.events);
    expect(event.level).toBe('fatal');
    expect(event.defect?.name).toBe('TypeError');
    expect(event.defect?.stack).toContain('The probe failed.');
    expect(result.stderr).toBe('probe: Something went wrong.\n');
  },
);

test.each(['node', 'bun'])(
  'a distributed bundle run under %s logs a failed stdout write at fatal with the write error',
  (runtime) => {
    const result = bundledRun(runtime, 'stdout-broken');
    const { event } = only(result.events);
    expect(event.level).toBe('fatal');
    expect(event.defect?.message).toBe('write ENOSPC');
    expect(result.stderr).toBe('probe: Something went wrong.\n');
  },
);
