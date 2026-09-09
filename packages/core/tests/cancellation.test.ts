import { expect, test } from 'vite-plus/test';

import { invoke, start } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/cancel.mjs', import.meta.url);

/** One invocation of the cancellation fixture under the plugins one scenario installs. */
function run(scenario: string, env: Record<string, string> = {}) {
  return invoke(fixture, [scenario], { env });
}

/** The same fixture spawned so a test can send it a real process signal once it is ready. */
function spawnRun(scenario: string, env: Record<string, string> = {}) {
  return start(fixture, [scenario], { env });
}

test('a caller abort during a run resolves 130 with the caller as its source', () => {
  expect(run('caller-abort')).toEqual({
    status: 130,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:0:0',
      'ready',
      'action:caller:the caller stopped the run',
      'after:0:0',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('a caller signal already aborted at entry resolves 130 having loaded nothing', () => {
  // The graph still builds and validates, so a declaration fault would still be reported; the
  // Plugin's loader is never called, no middleware or action runs, and no listener is installed.
  expect(run('pre-aborted')).toEqual({
    status: 130,
    stderr: '',
    stdout: 'before:0:0\nafter:0:0\nresolved:130\n',
  });
});

test('a loader pending when the abort lands settles and its middleware is skipped', () => {
  expect(run('pending-loader')).toEqual({
    status: 130,
    stderr: '',
    stdout: 'before:0:0\nafter:0:0\nresolved:130\n',
  });
});

test("a wrapper reads 'cancelled' whether the chain took over or continued", () => {
  const takenOver = run('wrapped');
  expect(takenOver).toEqual({
    status: 130,
    stderr: '',
    stdout: 'before:0:0\nmiddleware:ran\nwrapper:cancelled\nafter:0:0\nresolved:130\n',
  });
  // The same outcome when the cancelling middleware continues: the action is never dispatched.
  expect(run('wrapped', { LOOM_FIXTURE_CANCEL: 'continue' })).toEqual(takenOver);
});

test('a cancelled run whose failure renderer throws still resolves the cancellation code', () => {
  expect(run('broken-renderer', { LOOM_FIXTURE_THROW: 'fatal' })).toEqual({
    status: 130,
    stderr:
      'the action stopped the invocation\nInternal error: Rendering the failure failed: the failure renderer could not answer\n',
    stdout: [
      'before:0:0',
      'during:0:0',
      'ready',
      'action:caller:the caller stopped the run',
      'after:0:0',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('a thrown cancellation is silent after the abort, and any other failure is rendered', () => {
  const silent = {
    status: 130,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:0:0',
      'ready',
      'action:caller:the caller stopped the run',
      'after:0:0',
      'resolved:130',
      '',
    ].join('\n'),
  };
  expect(run('abort-error', { LOOM_FIXTURE_THROW: 'reason' })).toEqual(silent);
  expect(run('abort-error', { LOOM_FIXTURE_THROW: 'named' })).toEqual(silent);
  expect(run('abort-error', { LOOM_FIXTURE_THROW: 'fatal' })).toEqual({
    ...silent,
    stderr: 'the action stopped the invocation\n',
  });
});

test('a SIGINT during a cooperative action resolves 130 and names its source', async () => {
  const running = spawnRun('owner');
  await running.announced('ready');
  running.child.kill('SIGINT');
  await expect(running.exit).resolves.toEqual({
    signal: null,
    status: 130,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:1:1',
      'ready',
      'aborted:SIGINT',
      'action:SIGINT:none',
      'after:0:0',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('a SIGTERM resolves 143 and leaves no listener behind', async () => {
  const running = spawnRun('owner');
  await running.announced('ready');
  running.child.kill('SIGTERM');
  await expect(running.exit).resolves.toEqual({
    signal: null,
    status: 143,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:1:1',
      'ready',
      'aborted:SIGTERM',
      'action:SIGTERM:none',
      'after:0:0',
      'resolved:143',
      '',
    ].join('\n'),
  });
});

test('a repeated SIGINT ends the process through the default disposition', async () => {
  const running = spawnRun('owner', { LOOM_FIXTURE_ACTION: 'ignoring' });
  await running.announced('ready');
  running.child.kill('SIGINT');
  // The first signal cancelled the run, the action ignores it, and core keeps awaiting the chain.
  await running.announced('aborted:SIGINT');
  running.child.kill('SIGINT');
  const result = await running.exit;
  expect({ signal: result.signal, status: result.status }).toEqual({
    signal: 'SIGINT',
    status: null,
  });
  expect(result.stdout).toBe('before:0:0\nduring:1:1\nready\naborted:SIGINT\n');
});

test('a run with no owner and no caller signal installs no listener', async () => {
  const running = spawnRun('no-owner');
  await running.announced('ready');
  running.child.kill('SIGINT');
  const result = await running.exit;
  expect({ signal: result.signal, status: result.status }).toEqual({
    signal: 'SIGINT',
    status: null,
  });
  expect(result.stdout).toBe('before:0:0\nduring:0:0\nready\n');
});

test('two runs of one Application each install and remove their own listeners', () => {
  expect(run('twice', { LOOM_FIXTURE_ACTION: 'finishing' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'before:0:0\nduring:1:1\nbetween:0:0\nduring:1:1\nafter:0:0\nresolved:0:0\n',
  });
});
