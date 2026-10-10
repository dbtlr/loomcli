import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

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
function read(result: { status: number | null; stderr: string; stdout: string }) {
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

function run(scenario: string, argv: string[] = [], env: Record<string, string> = {}) {
  return read(
    invoke(fixture, [scenario, ...argv], { env: { FIXTURE_BUILD: 'distributed', ...env } }),
  );
}

/** The events of a run, with the identity of each reduced to what a test compares. */
function summary(scenario: string, argv: string[] = [], env: Record<string, string> = {}) {
  return run(scenario, argv, env).events.map(({ event }) => [
    event.level,
    event.message,
    event.plugin,
  ]);
}

/** The script that bundles a fixture with `Bun.build` and a define, as `loom build` does. */
const bundler = fileURLToPath(new URL('fixtures/release/bundle.mjs', import.meta.url));

const root = mkdtempSync(join(tmpdir(), 'loom-logging-'));

afterAll(() => {
  rmSync(root, { force: true, recursive: true });
});

const isoTime = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u;
const traceId = /^[0-9a-f]{32}$/u;

test('an action, a middleware, a source, and an onFailure hook each log one event in call order', () => {
  expect(summary('reach')).toEqual([
    ['info', 'from source', 'fixture/reaching'],
    ['info', 'from middleware', 'fixture/reaching'],
    ['info', 'from action', null],
    ['info', 'from hook', 'fixture/reaching'],
    ['error', 'The action failed.', null],
  ]);
});

test("a plugin Command's action logs under no plugin", () => {
  expect(summary('reach', ['plug'])).toEqual([
    ['info', 'from source', 'fixture/reaching'],
    ['info', 'from middleware', 'fixture/reaching'],
    ['info', 'from plugin command', null],
  ]);
});

test('a call returns undefined and delivers a frozen event, whose methods keep working detached', () => {
  const basic = run('basic');
  expect(basic.printed).toEqual([{}]);
  expect(basic.events).toHaveLength(1);
  expect(basic.events[0]?.frozen).toBe(true);
  expect(basic.events[0]?.event).toMatchObject({
    fields: { count: 1 },
    level: 'info',
    message: 'hello',
    plugin: null,
  });
  expect(summary('detached')).toEqual([['info', 'detached', null]]);
});

test('the five levels log in call order and the log has no fatal', () => {
  const levels = run('levels');
  expect(levels.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['trace', 'trace message'],
    ['debug', 'debug message'],
    ['info', 'info message'],
    ['warn', 'warn message'],
    ['error', 'error message'],
  ]);
  expect(levels.printed).toEqual([{ fatal: 'undefined' }]);
});

test('a message that is not a string is converted with String, and omitted fields read {}', () => {
  expect(summary('message-converted')).toEqual([
    ['info', '42', null],
    ['warn', 'object message', null],
  ]);
  expect(run('empty-fields').events[0]?.event.fields).toEqual({});
});

test('fields copy into the JSON data JSON.stringify produces, with the four differences', () => {
  const collected = only(run('copy').events);
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
    throwing: { bad: '[Unreadable]', ok: 1 },
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

test("a caller's change to the object after the call leaves the event unchanged", () => {
  expect(run('changed').events[0]?.event.fields).toEqual({ count: 1, nested: { value: 1 } });
});

test('time, run, and application are read at the call in the pinned forms', () => {
  const [collected] = run('version').events;
  expect(collected?.event.time).toMatch(isoTime);
  expect(collected?.event.run).toMatch(traceId);
  expect(collected?.event.application).toEqual({ name: 'probe', version: '1.2.3' });
  expect(run('unversioned').events[0]?.event.application).toEqual({
    name: 'probe',
    version: '0.0.0',
  });
});

test('run is equal across one run, and different for the run, an action invoke, and app.invoke', () => {
  const { events } = run('runs');
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
  expect(run('runs').events[0]?.event.run).not.toBe(outer?.run);
});

test('path reads empty before routing, partial for an unknown Command, and routed in an action', () => {
  const routed = run('path-routed', ['cache', 'clear']).events;
  expect(routed.map(({ event }) => event.path)).toEqual([['cache', 'clear']]);
  const structural = run('path-routed', ['--file']).events;
  expect(structural.map(({ event }) => [event.level, event.path])).toEqual([['error', []]]);
  const unknown = run('path-routed', ['cache', 'nope']).events;
  expect(unknown.map(({ event }) => [event.level, event.path])).toEqual([['error', ['cache']]]);
});

test('an InputError logs at error with its failure form and exit code 2', () => {
  const result = run('input-error', ['--bogus']);
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

test('a TypeError logs at fatal with its name, message, and stack from source', () => {
  const result = run('type-error', [], { FIXTURE_BUILD: 'development' });
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

test('a distributed build logs the defect with its stack while stderr holds the generic sentence', () => {
  const result = run('type-error', [], { FIXTURE_BUILD: 'distributed' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.message).toBe('Something went wrong.');
  expect(event.failure?.message).toBe('Something went wrong.');
  expect(event.defect?.name).toBe('TypeError');
  expect(event.defect?.message).toBe('The probe failed.');
  expect(event.defect?.stack).toContain('The probe failed.');
  expect(result.stderr).toBe('probe: Something went wrong.\n');
});

test('a defect without a thrown Error cause reads the failure itself', () => {
  const result = run('internal-error', [], { FIXTURE_BUILD: 'distributed' });
  const { event } = only(result.events);
  expect(event.level).toBe('fatal');
  expect(event.defect).toMatchObject({
    message: 'The action reported a defect.',
    name: 'InternalError',
  });
});

test('a fault reported after the outcome logs its own event', () => {
  const result = run('after-primary', [], { FIXTURE_BUILD: 'distributed' });
  expect(result.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['error', 'The action failed.'],
    ['fatal', 'Something went wrong.'],
  ]);
  expect(result.events[1]?.event.defect?.message).toContain('next()');
});

test('a failed action invoke logs its failure event under the nested run', () => {
  const result = run('invoke-failure');
  expect(result.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['error', 'The inner failed.'],
    ['info', 'after inner'],
  ]);
  const [inner, after] = result.events.map(({ event }) => event);
  expect(inner?.run).not.toBe(after?.run);
  expect(result.printed).toEqual([{ inner: 'failed' }]);
});

test('a cancelled run whose action rejects with the signal reason logs no failure event', () => {
  const result = run('cancelled-silent');
  expect(result.resolved).toBe('resolved:130');
  expect(result.events).toEqual([]);
});

test('a failure a cancelled run still renders logs one event, and the run keeps 130', () => {
  const result = run('cancelled-rendered');
  expect(result.resolved).toBe('resolved:130');
  expect(result.events.map(({ event }) => [event.level, event.message])).toEqual([
    ['error', 'The action failed.'],
  ]);
});

test('a build fault logs no event', () => {
  const result = run('build-fault');
  expect(result.status).toBe(1);
  expect(result.events).toEqual([]);
});

test('with no plugin that declares onLog, a call returns undefined and a getter is never read', () => {
  expect(run('unlogged').printed).toEqual([{ reads: 0, returned: true }]);
  expect(run('listened').printed).toEqual([{ reads: 1 }]);
});

test('a log call during delivery reports the log-in-log-hook defect once and exits 1', () => {
  const developed = run('log-in-hook', [], { FIXTURE_BUILD: 'development' });
  expect(developed.status).toBe(1);
  expect(developed.stderr).toMatch(/^-- [A-Z -]+ -+ @loomcli\/core\/log-in-log-hook\n\n/u);
  expect(developed.stderr).toContain('A log call ran while core was delivering a log event.\n');
  expect(developed.stderr).toContain(
    'Remove the log call from the onLog hook: an onLog hook observes events and never logs.\n',
  );
  expect(developed.stderr.match(/log-in-log-hook/gu)).toHaveLength(1);
  const distributed = run('log-in-hook', [], { FIXTURE_BUILD: 'distributed' });
  expect(distributed.status).toBe(1);
  expect(distributed.stderr).toBe('probe: Something went wrong.\n');
});

test.each(['node', 'bun'])(
  'a distributed bundle run under %s logs the defect at fatal with its stack and writes the generic sentence',
  (runtime) => {
    const outdir = join(root, runtime);
    const built = spawnSync(
      'bun',
      [bundler, 'logging.mjs', outdir, JSON.stringify({ build: 'distributed' })],
      { encoding: 'utf8', timeout: 60_000 },
    );
    expect(built.stderr).toBe('');
    expect(built.status).toBe(0);
    const result = read(
      spawnSync(runtime, [join(outdir, 'logging.js'), 'type-error'], {
        encoding: 'utf8',
        timeout: 60_000,
      }),
    );
    const { event } = only(result.events);
    expect(event.level).toBe('fatal');
    expect(event.defect?.name).toBe('TypeError');
    expect(event.defect?.stack).toContain('The probe failed.');
    expect(result.stderr).toBe('probe: Something went wrong.\n');
  },
);
