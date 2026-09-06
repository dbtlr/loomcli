import { expect, test } from 'vite-plus/test';

import { invoke } from './process.js';

test('output queued by a completed write is also finished before run resolves', () => {
  expect(invoke('tests/fixtures/output.mjs', ['chained'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"code":0,"events":["one\\n","two\\n"],"listeners":0}\n',
  });
});

test('unawaited writes finish in destination order before run resolves', () => {
  expect(invoke('tests/fixtures/output.mjs', ['delayed'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"code":0,"events":["one\\n","two\\n","three\\n"],"listeners":0}\n',
  });
});

test('semantic output preserves whitespace and nonfatal errors do not change success', () => {
  expect(invoke('tests/fixtures/output.mjs', ['semantics'])).toEqual({
    status: 0,
    stderr: 'info\nsuccess\nwarn\nerror\n',
    stdout: '{"code":0,"events":[" \\ntext\\t\\n"],"listeners":0}\n',
  });
});

test.each(['failed', 'caught-write', 'double-failed', 'closed'])(
  '%s output cannot escape the completion boundary',
  (scenario) => {
    const result = invoke('tests/fixtures/output.mjs', [scenario]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe(
      `${JSON.stringify({
        code: 1,
        events: scenario === 'caught-write' ? ['caught'] : [],
        listeners: 0,
      })}\n`,
    );
    expect(result.stderr).toBe(
      scenario === 'double-failed' ? '' : 'Internal error: Could not write invocation output.\n',
    );
  },
);

test('a failed diagnostic write gets exactly one fallback attempt', () => {
  expect(invoke('tests/fixtures/output.mjs', ['diagnostic-write'])).toEqual({
    status: 1,
    stderr: '',
    stdout: '{"code":1,"events":[],"listeners":0,"attempts":2}\n',
  });
});

test('a failure while rendering an exception uses plain fallback output', () => {
  expect(invoke('tests/fixtures/output.mjs', ['renderer-failed'])).toEqual({
    status: 1,
    stderr: 'Internal error: Could not write invocation output.\n',
    stdout: '{"code":1,"events":[],"listeners":0}\n',
  });
});
