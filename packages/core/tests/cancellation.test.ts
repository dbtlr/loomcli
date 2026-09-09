import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/cancel.mjs', import.meta.url);

/** One invocation of the cancellation fixture under the plugins one scenario installs. */
function run(scenario: string, env: Record<string, string> = {}) {
  return invoke(fixture, [scenario], { env });
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
