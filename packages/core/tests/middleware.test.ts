/*
 * Acceptance plan for the plugin seam (docs/core/plugin-contract.md).
 *
 * The seam is proven when both example applications install a plugin through `plugins` and public
 * APIs alone. The suites cover it with in-repository fixture plugins rather than a published
 * package, each case under Node and Bun:
 *
 * - A plugin with option-activated middleware whose implementation module records its own
 *   evaluation, so a test shows the module is never loaded on an invocation that does not supply
 *   its option and never loaded when an earlier middleware takes over.
 * - A plugin with always-on middleware that wraps `next()` and observes each outcome value.
 * - A plugin whose loader is pending when a caller abort lands, so a test shows the run resolves
 *   130 once the loader settles and the middleware never runs
 *   (packages/core/tests/cancellation.test.ts).
 * - A plugin that claims the signals slot, with a second claimant failing at construction and no
 *   listener surviving a run (packages/core/tests/plugins.test.ts).
 * - A plugin that defines an extension both examples attach to a Command
 *   (packages/core/tests/extensions.test.ts).
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/invoke.mjs', import.meta.url);

/** One invocation of the fixture application under the plugins one scenario installs. */
function run(scenario: string, argv: string[], env: Record<string, string> = {}) {
  return invoke(fixture, [scenario, 'run', ...argv], { env: { TERM: 'xterm-256color', ...env } });
}

/**
 * The same invocation with a marks file, so a test reads which plugin implementation modules the
 * invocation evaluated. A module that never loaded leaves no line.
 */
function loaded(scenario: string, argv: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-plugin-marks-'));
  const marks = join(directory, 'marks.txt');
  try {
    const result = run(scenario, argv, { LOOM_FIXTURE_MARKS: marks });
    let lines: string[] = [];
    try {
      lines = readFileSync(marks, 'utf8').split('\n').filter(Boolean);
    } catch {
      lines = [];
    }
    return { ...result, marks: lines };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('an invocation that supplies no plugin option loads no plugin implementation', () => {
  const result = loaded('help', ['get', 'a.b']);
  expect(result.marks).toEqual([]);
  expect(result.stdout).toBe(
    'get:a.b:{"help":false,"version":false,"raw":false}\naction-signal:true:false\nresolved:0\n',
  );
});

test('a takeover earlier in the chain never loads a later plugin', () => {
  const result = loaded('help', ['--help', '--version', 'get']);
  expect(result.marks).toEqual(['loaded:help']);
  expect(result).toMatchObject({ status: 0, stderr: '', stdout: 'help:get\nresolved:0\n' });
});

test('the second plugin loads and takes over when the first is not activated', () => {
  const result = loaded('help', ['--version']);
  expect(result.marks).toEqual(['loaded:version']);
  expect(result.stdout).toBe('version:1.2.0\nresolved:0\n');
});

test('a takeover never raises the fault core held and resolves 0', () => {
  // `get` needs a required argument and `--nope` is no declared option; neither fault is raised.
  expect(run('help', ['-h', 'get', '--nope'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:get\nresolved:0\n',
  });
});

test('a middleware renders help for the routed group without the callable check', () => {
  expect(run('help', ['--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:(root)\nresolved:0\n',
  });
});

test('an unknown command fails in routing before any middleware runs', () => {
  const result = loaded('wrapped', ['nope']);
  expect(result.marks).toEqual([]);
  expect(result).toMatchObject({
    status: 2,
    stderr: 'app: Unknown command "nope". Use one of: get, cache.\n',
  });
});

test('a middleware takes over a group invocation and the callable check is never raised', () => {
  expect(run('help', ['--help', 'cache'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help:cache\nresolved:0\n',
  });
});

test('the callable check still rejects a group when no middleware takes over', () => {
  const result = run('wrapped', ['cache']);
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    'ℹ outer:start\nℹ inner:start\nℹ inner:rejected:Command "cache" requires a subcommand. Use one of: clear.\nℹ inner:cleanup\nℹ outer:rejected:Command "cache" requires a subcommand. Use one of: clear.\nℹ outer:cleanup\napp: Command "cache" requires a subcommand. Use one of: clear.\n',
  );
});

test('two always-on wrappers unwind in reverse installation order', () => {
  const result = run('wrapped', ['get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    'ℹ outer:start\nℹ inner:start\nℹ inner:dispatched\nℹ inner:cleanup\nℹ outer:dispatched\nℹ outer:cleanup\n',
  );
});

test('a wrapper reads a later takeover as its own outcome', () => {
  const result = run('wrapped-help', ['--help', 'get']);
  expect(result.stderr).toBe('ℹ outer:start\nℹ outer:taken-over\nℹ outer:cleanup\n');
  expect(result.stdout).toBe('help:get\nresolved:0\n');
});

test('a middleware that catches its second next() call decides the outcome', () => {
  const result = run('misuse', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'twice' });
  expect(result).toEqual({
    status: 0,
    stderr: 'ℹ misuse:Plugin "@fixture/misuse" called next() twice.\n',
    stdout: 'get:a.b:{"raw":false}\naction-signal:true:false\nresolved:0\n',
  });
});

test('a second next() call the middleware lets escape is its failure', () => {
  const result = run('misuse', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'escaping' });
  expect(result).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: 'get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n',
  });
});

test('a second next() call no code observes fails the run with one next-misuse report', () => {
  const env = { LOOM_FIXTURE_MISUSE: 'unawaited' };
  expect(run('misuse', ['get', 'a.b'], env)).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: 'get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n',
  });
  const development = invoke(fixture, ['misuse', 'development', 'get', 'a.b'], {
    env: { TERM: 'xterm-256color', ...env },
  });
  expect(development.status).toBe(1);
  expect(development.stdout).toBe('get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n');
  expect(development.stderr.match(/@loomcli\/core\/next-misuse/gu)).toHaveLength(1);
  expect(development.stderr).toContain('Plugin "@fixture/misuse" called next() twice.');
});

test('a next() call a timer makes after the middleware returned, which no code observes, fails the open run', () => {
  expect(run('misuse', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'late' })).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: 'get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n',
  });
});

test('calling next() after the middleware returned rejects with its own sentence', () => {
  const result = run('misuse', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'after-return' });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    'ℹ misuse:Plugin "@fixture/misuse" called next() after its middleware returned.\n',
  );
});

test('a next() misuse that escapes reaches the view the application registered for its class', () => {
  const result = run('misuse-rendered', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'escaping' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('app internal: Plugin "@fixture/misuse" called next() twice.\n');
});

test('a next() a middleware kept and called after it returned rejects and dispatches nothing', () => {
  expect(run('stashed', ['get', 'a.b'])).toEqual({
    status: 0,
    stderr:
      'ℹ stashing:taken-over\nℹ caller:taken-over\nℹ caller:Plugin "@fixture/stashing" called next() after its middleware returned.\n',
    stdout: 'resolved:0\n',
  });
});

test('a middleware that catches and throws its own failure exits with that failure', () => {
  expect(run('recatching', ['get'])).toEqual({
    status: 1,
    stderr:
      'ℹ recatching:Argument "path" requires a value. Supply a value for "path".\napp: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});

test('a middleware that catches the held fault decides the outcome, read as taken-over', () => {
  expect(run('wrapped-catching', ['get'])).toEqual({
    status: 0,
    stderr:
      'ℹ outer:start\nℹ catching:caught:Argument "path" requires a value. Supply a value for "path".\nℹ outer:taken-over\nℹ outer:cleanup\n',
    stdout: 'resolved:0\n',
  });
});

test("a middleware that catches the action's failure decides the outcome, read as dispatched", () => {
  expect(run('wrapped-catching', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' })).toEqual({
    status: 0,
    stderr:
      'ℹ outer:start\nℹ catching:caught:the action stopped the invocation\nℹ outer:dispatched\nℹ outer:cleanup\n',
    stdout: 'resolved:0\n',
  });
});

test('a next() queued as a microtask lands before the middleware result settles', () => {
  // "`next` is live until the middleware's own result settles", so the queued call continues
  // The chain and the action dispatches under the wrapper that observes the outcome.
  const result = run('microtask', ['get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('ℹ outer:start\nℹ outer:dispatched\nℹ outer:cleanup\n');
  expect(result.stdout).toBe('get:a.b:{"raw":false}\naction-signal:true:false\nresolved:0\n');
});

test('a failure thrown before next() resolves through the failure path with its own code', () => {
  expect(run('throwing', ['get', 'a.b'], { LOOM_FIXTURE_THROW: 'fatal' })).toEqual({
    status: 1,
    stderr: 'the plugin stopped the invocation\n',
    stdout: 'resolved:1\n',
  });
  expect(run('throwing', ['get', 'a.b'], { LOOM_FIXTURE_THROW: 'usage' })).toEqual({
    status: 2,
    stderr: 'app: the plugin rejected the invocation\n',
    stdout: 'resolved:2\n',
  });
});

test('a middleware failure before next() wins over a held missing argument', () => {
  expect(run('throwing', ['get'], { LOOM_FIXTURE_THROW: 'fatal' })).toEqual({
    status: 1,
    stderr: 'the plugin stopped the invocation\n',
    stdout: 'resolved:1\n',
  });
});

test("a throw during unwinding is the middleware's failure, with its own class and code", () => {
  expect(run('throwing', ['get', 'a.b'], { LOOM_FIXTURE_THROW: 'unwind' })).toEqual({
    status: 1,
    stderr: 'ℹ throwing:dispatched\napp: Something went wrong.\n',
    stdout: 'get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n',
  });
  expect(run('throwing', ['get', 'a.b'], { LOOM_FIXTURE_THROW: 'unwind-usage' })).toEqual({
    status: 2,
    stderr: 'ℹ throwing:dispatched\napp: the plugin rejected the outcome\n',
    stdout: 'get:a.b:{"raw":false}\naction-signal:true:false\nresolved:2\n',
  });
});

test("a middleware that catches the action's failure and returns exits 0", () => {
  expect(run('catching', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' })).toEqual({
    status: 0,
    stderr: 'ℹ catching:caught:the action stopped the invocation\n',
    stdout: 'resolved:0\n',
  });
});

test('a loader that rejects is an internal error with code 1', () => {
  const result = run('broken', ['get', 'a.b']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('app: Something went wrong.\n');
  expect(result.stdout).toBe('resolved:1\n');
});

test('a loader that throws synchronously names its own plugin', () => {
  expect(run('sync-loader', ['get', 'a.b'])).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});

test('a module without a default middleware function is an internal error with code 1', () => {
  expect(run('no-default', ['get', 'a.b'])).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});

test('the run signal reaches the middleware and the action, and nothing aborts it', () => {
  const result = run('signals', ['get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stdout).toBe(
    'middleware-signal:true:false\nget:a.b:{"raw":false}\naction-signal:true:false\nresolved:0\n',
  );
});
