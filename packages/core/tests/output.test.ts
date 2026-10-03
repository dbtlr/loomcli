import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('output queued by a completed write is also finished before run resolves', () => {
  expect(invoke(new URL('fixtures/output.mjs', import.meta.url), ['chained'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"code":0,"events":["one\\n","two\\n"],"listeners":0}\n',
  });
});

test('unawaited writes finish in destination order before run resolves', () => {
  expect(invoke(new URL('fixtures/output.mjs', import.meta.url), ['delayed'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"code":0,"events":["one\\n","two\\n","three\\n"],"listeners":0}\n',
  });
});

test('semantic output preserves whitespace and nonfatal errors do not change success', () => {
  expect(invoke(new URL('fixtures/output.mjs', import.meta.url), ['semantics'])).toEqual({
    status: 0,
    stderr: 'ℹ info\n✔ success\n⚠ warn\n✘ error\n',
    stdout: '{"code":0,"events":[" \\ntext\\t\\n"],"listeners":0}\n',
  });
});

test.each(['failed', 'caught-write', 'double-failed', 'closed'])(
  '%s output cannot escape the completion boundary',
  (scenario) => {
    const result = invoke(new URL('fixtures/output.mjs', import.meta.url), [scenario]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `${JSON.stringify({
        code: 1,
        events: scenario === 'caught-write' ? ['caught'] : [],
        listeners: 0,
      })}\n`,
    );
    expect(result.stderr).toBe(
      scenario === 'double-failed' ? '' : 'output: Something went wrong.\n',
    );
  },
);

test('a failed diagnostic write gets exactly one fallback attempt', () => {
  expect(invoke(new URL('fixtures/output.mjs', import.meta.url), ['diagnostic-write'])).toEqual({
    status: 1,
    stderr: '',
    stdout: '{"code":1,"events":[],"listeners":0,"attempts":2}\n',
  });
});

test('an action that throws an Error whose message cannot be read reports the fixed reason', () => {
  expect(invoke(new URL('fixtures/output.mjs', import.meta.url), ['renderer-failed'])).toEqual({
    status: 1,
    stderr: 'output: Something went wrong.\n',
    stdout: '{"code":1,"events":[],"listeners":0}\n',
  });
});

test('an unusable fallback destination still resolves the failure status', () => {
  expect(invoke(new URL('fixtures/reporting.mjs', import.meta.url))).toEqual({
    status: 1,
    stderr: '',
    stdout: 'resolved:1\n',
  });
});

/** One run of the replaced-stream fixture, with the line it prints read back. */
function replacedStream(args: string[]) {
  const result = invoke(new URL('fixtures/hostile-streams.mjs', import.meta.url), args);
  const printed: unknown = JSON.parse(result.stdout);
  return { printed, status: result.status, stderr: result.stderr };
}

/**
 * A host stream that breaks the Writable contract cannot hold a failed run open. Core stops waiting
 * on a stream that never calls back once the run has a failure to report, so the action's own
 * failure is still reported. A stream whose own `_write` throws rejects that write at once, which is
 * a broken destination, and holds every later write, the plain fallback's included.
 */
test.each([
  ['stdout', 'silent', 'Action failed.\n'],
  ['stderr', 'silent', ''],
  ['stdout', 'throwing', 'hostile: Something went wrong.\n'],
  ['stderr', 'throwing', ''],
])(
  'a failed run whose %s is %s resolves 1 and removes its signal listeners',
  (stream, behavior, stderr) => {
    expect(replacedStream([stream, behavior])).toEqual({
      printed: { after: '0:0', atResolve: [], before: '0:0', code: 1, delivered: [] },
      status: 1,
      stderr,
    });
  },
);

test.each([
  ['stdout', ['one\n'], 'Action failed.\n'],
  ['stderr', ['ℹ one\n', 'Action failed.\n'], ''],
])('a failed run keeps the action failure and every byte on a slow %s', (stream, bytes, stderr) => {
  const { printed, status, stderr: written } = replacedStream([stream, 'slow']);
  expect({ status, written }).toEqual({ status: 1, written: stderr });
  expect(printed).toMatchObject({ code: 1, delivered: bytes });
});

test('a successful run waits for a slow stream past the reporting bound', () => {
  expect(replacedStream(['stdout', 'slow', 'succeeds'])).toEqual({
    printed: { after: '0:0', atResolve: ['one\n'], before: '0:0', code: 0, delivered: ['one\n'] },
    status: 0,
    stderr: '',
  });
});

/**
 * A write still in flight when core stops waiting can fail later, as a pipe whose reader quit
 * does. Core keeps listening for that stream's error until the write settles, so the late failure
 * neither crashes the process nor changes the code the run resolved.
 */
test.each([
  ['stdout', 'Action failed.\n'],
  ['stderr', ''],
])('a write on %s that fails after a failed run resolved keeps its code', (stream, stderr) => {
  expect(replacedStream([stream, 'failing-late'])).toEqual({
    printed: { after: '0:0', atResolve: [], before: '0:0', code: 1, delivered: [] },
    status: 1,
    stderr,
  });
});

/**
 * A middleware that fails after the action returned gives the run a failure to report before its
 * output drains, so the wait on a stream that never calls back is bounded too.
 */
test('a middleware failure after next() bounds the wait on a silent stdout', () => {
  expect(replacedStream(['stdout', 'silent', 'middleware-fails'])).toEqual({
    printed: { after: '0:0', atResolve: [], before: '0:0', code: 1, delivered: [] },
    status: 1,
    stderr: 'hostile: Something went wrong.\n',
  });
});
