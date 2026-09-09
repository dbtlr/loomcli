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
  // Plugin's loader is never called, no middleware or action runs, and the probe shows that no
  // Listener was added at any point, which a count taken after the run could not tell.
  expect(run('pre-aborted')).toEqual({
    status: 130,
    stderr: '',
    stdout: 'before:0:0\nadded:none\nafter:0:0\nresolved:130\n',
  });
});

test('a run that fails to build installs no listener and keeps its declaration diagnostic', () => {
  expect(run('build-fault')).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Plugin "@acme/trace" claims the signals slot, which plugin "@fixture/owner" already holds. Install one owner.\n',
    stdout: 'before:0:0\nadded:none\nresolved:1\n',
  });
});

test('a declared default its schema rejects installs no listener and still resolves 1', () => {
  expect(run('default-fault')).toEqual({
    status: 1,
    stderr:
      'Invalid declaration: Option "level" has an invalid default. Fix the default or its schema.\nOption "level": Supply a level the schema accepts.\n',
    stdout: 'before:0:0\nadded:none\nresolved:1\n',
  });
});

test('a run signal that is not an AbortSignal is an internal error with code 1', () => {
  expect(run('not-a-signal')).toEqual({
    status: 1,
    stderr:
      'Internal error: run() received a signal that is not an AbortSignal. Supply the signal of an AbortController.\n',
    stdout: 'before:0:0\nafter:0:0\nresolved:1\n',
  });
});

test('a host stderr that refuses every write leaves no listener behind', () => {
  // Core reports the action's failure to the host's stderr, which refuses it, so the real stderr
  // Stays empty and the run resolves 1. The bracket is removed whichever way the run ends.
  expect(run('hostile-stderr', { LOOM_FIXTURE_ACTION: 'refusing' })).toEqual({
    status: 1,
    stderr: '',
    stdout: 'before:0:0\nduring:1:1\nafter:0:0\nresolved:1\n',
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

test('the first cause fixes the reason and the code, and a later cause changes neither', async () => {
  const running = spawnRun('first-cause', { LOOM_FIXTURE_ACTION: 'racing' });
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

test('a caller abort holds its reason against a later signal, which takes the force path', async () => {
  const running = spawnRun('caller-then-signal', { LOOM_FIXTURE_ACTION: 'absorbing' });
  await running.announced('ready');
  running.child.kill('SIGINT');
  // The embedding host's own listener absorbs the signal and the re-raise, so the process survives
  // Both and the run resolves the code its first cause fixed. Core's own listeners are gone.
  await expect(running.exit).resolves.toEqual({
    signal: null,
    status: 130,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:1:1',
      'aborted:caller',
      'ready',
      'action:caller:the caller stopped the run',
      'after:1:0',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('a first signal after the chain settled still cancels the run and decides its code', async () => {
  const running = spawnRun('slow-flush', { LOOM_FIXTURE_ACTION: 'flushing' });
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
      'after:0:0',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('two cancelled slot-owning runs re-raise in turn until no listener remains', async () => {
  const running = spawnRun('two-runs');
  await running.announced('ready');
  // The first signal cancels run A, whose synchronous abort listener starts run B.
  running.child.kill('SIGINT');
  await running.announced('second:2:2');
  // The second signal cancels B and makes A re-raise; B, cancelled by then, re-raises in turn.
  running.child.kill('SIGINT');
  const result = await running.exit;
  expect({ signal: result.signal, status: result.status }).toEqual({
    signal: 'SIGINT',
    status: null,
  });
  expect(result.stdout).toBe('before:0:0\nfirst:1:1\nready\nsecond:2:2\n');
});

test('two runs of one Application each install and remove their own listeners', () => {
  expect(run('twice', { LOOM_FIXTURE_ACTION: 'finishing' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'before:0:0\nduring:1:1\nbetween:0:0\nduring:1:1\nafter:0:0\nresolved:0:0\n',
  });
});
