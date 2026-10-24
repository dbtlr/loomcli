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
      'during:1:1',
      'ready',
      'action:caller:the caller stopped the run',
      'after:0:0',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('an action that catches the cancellation and returns still resolves the signal code', () => {
  expect(run('caller-abort', { LOOM_FIXTURE_ACTION: 'catching' })).toEqual({
    status: 130,
    stderr: '',
    stdout: 'before:0:0\ncaught\nafter:0:0\nresolved:130\n',
  });
});

test('a cancelled run with an unemitted result resolves the signal code and reports nothing', () => {
  // An action that reads its signal and returns is the sanctioned path, so it owes no result.
  expect(run('result-unemitted', { LOOM_FIXTURE_ACTION: 'abandoning' })).toEqual({
    status: 130,
    stderr: '',
    stdout: 'before:0:0\nafter:0:0\nresolved:130\n',
  });
});

test('a caller signal already aborted at entry resolves 130 having loaded nothing', () => {
  /**
   * The graph still builds and validates, so a declaration fault would still be reported; the
   * plugin's loader is never called and no middleware or action runs. The run listened from the
   * moment it was called, as every `run()` does, and holds no listener once it resolved.
   */
  expect(run('pre-aborted')).toEqual({
    status: 130,
    stderr: '',
    stdout: 'before:0:0\nadded:SIGINT,SIGTERM\nafter:0:0\nresolved:130\n',
  });
});

test('a run that fails to build leaves no listener behind and keeps its declaration diagnostic', () => {
  expect(run('build-fault')).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: 'before:0:0\nadded:SIGINT,SIGTERM\nresolved:1\n',
  });
});

test('a declared default its validator rejects leaves no listener behind and still resolves 1', () => {
  expect(run('default-fault')).toEqual({
    status: 1,
    stderr: 'app: Something went wrong.\n',
    stdout: 'before:0:0\nadded:SIGINT,SIGTERM\nresolved:1\n',
  });
});

test('a host stderr that refuses every write leaves no listener behind', () => {
  /**
   * Core reports the action's failure to the host's stderr, which refuses it, so the real stderr
   * stays empty and the run resolves 1. The bracket is removed whichever way the run ends.
   */
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

test('a cancelled run whose failure view throws still resolves the cancellation code', () => {
  expect(run('broken-renderer', { LOOM_FIXTURE_THROW: 'fatal' })).toEqual({
    status: 130,
    stderr: 'the action stopped the invocation\napp: Something went wrong.\n',
    stdout: [
      'before:0:0',
      'during:1:1',
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
      'during:1:1',
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

test('a SIGINT during a cooperative action resolves 130, names its source, and the process dies by it', async () => {
  const running = spawnRun('watching');
  await running.announced('ready');
  running.child.kill('SIGINT');
  // The code after `run()` runs its synchronous part before the shutdown ends and re-raises.
  await expect(running.exit).resolves.toEqual({
    signal: 'SIGINT',
    status: null,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:1:1',
      'ready',
      'aborted:SIGINT',
      'action:SIGINT:none',
      'after:1:1',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('a SIGTERM resolves 143, and the process dies by it', async () => {
  const running = spawnRun('watching');
  await running.announced('ready');
  running.child.kill('SIGTERM');
  await expect(running.exit).resolves.toEqual({
    signal: 'SIGTERM',
    status: null,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:1:1',
      'ready',
      'aborted:SIGTERM',
      'action:SIGTERM:none',
      'after:1:1',
      'resolved:143',
      '',
    ].join('\n'),
  });
});

test('a second SIGINT ends the shutdown at once when the action ignores the first', async () => {
  const running = spawnRun('watching', { LOOM_FIXTURE_ACTION: 'ignoring' });
  await running.announced('ready');
  running.child.kill('SIGINT');
  // The first signal cancelled the run, the action ignores it, and the budget has not run out.
  await running.announced('aborted:SIGINT');
  running.child.kill('SIGINT');
  const result = await running.exit;
  expect({ signal: result.signal, status: result.status }).toEqual({
    signal: 'SIGINT',
    status: null,
  });
  expect(result.stdout).toBe('before:0:0\nduring:1:1\nready\naborted:SIGINT\n');
});

test('a run with no plugin listens all the same, so SIGINT unwinds it', async () => {
  const running = spawnRun('unwatched');
  await running.announced('ready');
  running.child.kill('SIGINT');
  const result = await running.exit;
  expect({ signal: result.signal, status: result.status }).toEqual({
    signal: 'SIGINT',
    status: null,
  });
  expect(result.stdout).toBe(
    'before:0:0\nduring:1:1\nready\naction:SIGINT:none\nafter:1:1\nresolved:130\n',
  );
});

test('the first cause fixes the reason and the code, and a later cause changes neither', async () => {
  const running = spawnRun('first-cause', { LOOM_FIXTURE_ACTION: 'racing' });
  await running.announced('ready');
  running.child.kill('SIGTERM');
  await expect(running.exit).resolves.toEqual({
    signal: 'SIGTERM',
    status: null,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:1:1',
      'ready',
      'aborted:SIGTERM',
      'action:SIGTERM:none',
      'after:1:1',
      'resolved:143',
      '',
    ].join('\n'),
  });
});

test("a caller abort holds its reason against a later signal, and a host's own listener keeps the process", async () => {
  const running = spawnRun('caller-then-signal', { LOOM_FIXTURE_ACTION: 'absorbing' });
  await running.announced('ready');
  running.child.kill('SIGINT');
  /**
   * The signal starts a shutdown that finds the run cancelled by its caller, so the run resolves
   * the code its first cause fixed. The embedding host's own listener receives the signal and
   * core's re-raise after the shutdown, so the process survives both and ends with that code.
   */
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
      'after:2:1',
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
    signal: 'SIGINT',
    status: null,
    stderr: '',
    stdout: [
      'before:0:0',
      'during:1:1',
      'ready',
      'aborted:SIGINT',
      'after:1:1',
      'resolved:130',
      '',
    ].join('\n'),
  });
});

test('a run an abort listener starts during the shutdown starts cancelled and extends nothing', async () => {
  const running = spawnRun('two-runs');
  await running.announced('ready');
  // The signal cancels run A, whose synchronous abort listener starts run B.
  running.child.kill('SIGINT');
  const result = await running.exit;
  // B resolves 130 without reaching its action, and A, which ignores its signal, ends at the budget.
  expect({ signal: result.signal, status: result.status }).toEqual({
    signal: 'SIGINT',
    status: null,
  });
  expect(result.stdout).toBe('before:0:0\nfirst:1:1\nready\nsecond:130\n');
});

test('two runs of one Application each install and remove their own listeners', () => {
  expect(run('twice', { LOOM_FIXTURE_ACTION: 'finishing' })).toEqual({
    status: 0,
    stderr: '',
    stdout: 'before:0:0\nduring:1:1\nbetween:0:0\nduring:1:1\nafter:0:0\nresolved:0:0\n',
  });
});
