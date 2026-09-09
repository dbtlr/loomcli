import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/invoke.mjs', import.meta.url);

/** One invocation of the fixture application under the plugins one scenario installs. */
function run(scenario: string, argv: string[], env: Record<string, string> = {}) {
  return invoke(fixture, [scenario, 'run', ...argv], { env });
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
  expect(result.stdout).toBe('get:a.b:{"raw":false}\naction-signal:true:false\nresolved:0\n');
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

test('a takeover leaves the remaining tokens unparsed and resolves 0', () => {
  // `get` needs a required argument and `--nope` is no declared option; neither is ever read.
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
    stderr: 'Invalid input: Unknown command "nope". Use one of: get, cache.\n',
  });
});

test('a middleware takes over a group invocation before the callable check', () => {
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
    'outer:start\ninner:start\ninner:rejected:Command "cache" requires a subcommand. Use one of: clear.\ninner:cleanup\nouter:rejected:Command "cache" requires a subcommand. Use one of: clear.\nouter:cleanup\nInvalid input: Command "cache" requires a subcommand. Use one of: clear.\n',
  );
});

test('two always-on wrappers unwind in reverse installation order', () => {
  const result = run('wrapped', ['get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    'outer:start\ninner:start\ninner:dispatched\ninner:cleanup\nouter:dispatched\nouter:cleanup\n',
  );
});

test('a wrapper reads a later takeover as its own outcome', () => {
  const result = run('wrapped-help', ['--help', 'get']);
  expect(result.stderr).toBe('outer:start\nouter:taken-over\nouter:cleanup\n');
  expect(result.stdout).toBe('help:get\nresolved:0\n');
});

test('calling next() twice rejects, dispatches nothing more, and turns a 0 into 1', () => {
  const result = run('misuse', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'twice' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'misuse:Plugin "@fixture/misuse" called next() twice.\nInternal error: Plugin "@fixture/misuse" called next() twice.\n',
  );
  expect(result.stdout).toBe('get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n');
});

test('a next() fault the middleware let escape is reported once, not twice', () => {
  const result = run('misuse', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'escaping' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('Internal error: Plugin "@fixture/misuse" called next() twice.\n');
  expect(result.stdout).toBe('get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n');
});

test('calling next() after the middleware returned rejects with its own sentence', () => {
  const result = run('misuse', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'after-return' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'misuse:Plugin "@fixture/misuse" called next() after its middleware returned.\nInternal error: Plugin "@fixture/misuse" called next() after its middleware returned.\n',
  );
});

test('a chain fault reaches the renderer the application registered for its class', () => {
  const result = run('misuse-rendered', ['get', 'a.b'], { LOOM_FIXTURE_MISUSE: 'twice' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'misuse:Plugin "@fixture/misuse" called next() twice.\napp internal: Plugin "@fixture/misuse" called next() twice.\n',
  );
});

test('a next() a middleware kept and called after it returned rejects and dispatches nothing', () => {
  const result = run('stashed', ['get', 'a.b']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'stashing:taken-over\ncaller:taken-over\ncaller:Plugin "@fixture/stashing" called next() after its middleware returned.\nInternal error: Plugin "@fixture/stashing" called next() after its middleware returned.\n',
  );
  expect(result.stdout).toBe('resolved:1\n');
});

test('a middleware that throws its own failure while unwinding leaves the caught code alone', () => {
  const result = run('recatching', ['get']);
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    'recatching:Argument "path" requires a value. Supply a value for "path".\nInvalid input: Argument "path" requires a value. Supply a value for "path".\nInternal error: the plugin failed after catching\n',
  );
  expect(result.stdout).toBe('resolved:2\n');
});

test('a wrapper reads a caught failure as taken-over when the action never ran', () => {
  const result = run('wrapped-catching', ['get']);
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    'outer:start\ncatching:caught:Argument "path" requires a value. Supply a value for "path".\nouter:taken-over\nouter:cleanup\nInvalid input: Argument "path" requires a value. Supply a value for "path".\n',
  );
});

test('a wrapper reads a caught failure as dispatched when the action ran and threw', () => {
  const result = run('wrapped-catching', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'outer:start\ncatching:caught:the action stopped the invocation\nouter:dispatched\nouter:cleanup\nthe action stopped the invocation\n',
  );
});

test('a next() queued as a microtask lands before the middleware result settles', () => {
  // "`next` is live until the middleware's own result settles", so the queued call continues
  // The chain and the action dispatches under the wrapper that observes the outcome.
  const result = run('microtask', ['get', 'a.b']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('outer:start\nouter:dispatched\nouter:cleanup\n');
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
    stderr: 'Invalid input: the plugin rejected the invocation\n',
    stdout: 'resolved:2\n',
  });
});

test('a throw during unwinding is reported after the primary outcome and turns a 0 into 1', () => {
  const result = run('throwing', ['get', 'a.b'], { LOOM_FIXTURE_THROW: 'unwind' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'throwing:dispatched\nInternal error: the plugin failed while unwinding\n',
  );
  expect(result.stdout).toBe('get:a.b:{"raw":false}\naction-signal:true:false\nresolved:1\n');
});

test('a throw during unwinding leaves the primary failure code alone', () => {
  const result = run('throwing', ['get', 'a.b'], {
    LOOM_FIXTURE_ACTION: 'fatal',
    LOOM_FIXTURE_THROW: 'unwind',
  });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('resolved:1\n');
});

test('a caught rejection changes the middleware control flow and not the exit code', () => {
  const result = run('catching', ['get', 'a.b'], { LOOM_FIXTURE_ACTION: 'fatal' });
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(
    'catching:caught:the action stopped the invocation\nthe action stopped the invocation\n',
  );
  expect(result.stdout).toBe('resolved:1\n');
});

test('a loader that rejects is an internal error with code 1', () => {
  const result = run('broken', ['get', 'a.b']);
  expect(result.status).toBe(1);
  expect(result.stderr).toMatch(/^Internal error: Loading plugin "@fixture\/broken" failed: /u);
  expect(result.stdout).toBe('resolved:1\n');
});

test('a loader that throws synchronously names its own plugin', () => {
  expect(run('sync-loader', ['get', 'a.b'])).toEqual({
    status: 1,
    stderr:
      'Internal error: Loading plugin "@fixture/sync-loader" failed: the loader threw before it could import\n',
    stdout: 'resolved:1\n',
  });
});

test('a module without a default middleware function is an internal error with code 1', () => {
  expect(run('no-default', ['get', 'a.b'])).toEqual({
    status: 1,
    stderr:
      'Internal error: Loading plugin "@fixture/no-default" failed: the module exports no default middleware function.\n',
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
