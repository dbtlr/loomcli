import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

test('output queued by a completed write is also finished before run resolves', async () => {
  await expect(
    invokeFixture(new URL('fixtures/output.mjs', import.meta.url), ['chained']),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"code":0,"events":["one\\n","two\\n"],"listeners":0}\n',
  });
});

test('unawaited writes finish in destination order before run resolves', async () => {
  await expect(
    invokeFixture(new URL('fixtures/output.mjs', import.meta.url), ['delayed']),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"code":0,"events":["one\\n","two\\n","three\\n"],"listeners":0}\n',
  });
});

test('semantic output preserves whitespace and nonfatal errors do not change success', async () => {
  await expect(
    invokeFixture(new URL('fixtures/output.mjs', import.meta.url), ['semantics']),
  ).resolves.toEqual({
    status: 0,
    stderr: 'ℹ info\n✔ success\n⚠ warn\n✘ error\n',
    stdout: '{"code":0,"events":[" \\ntext\\t\\n"],"listeners":0}\n',
  });
});

test.each(['failed', 'caught-write', 'double-failed', 'closed'])(
  '%s output cannot escape the completion boundary',
  async (scenario) => {
    const result = await invokeFixture(new URL('fixtures/output.mjs', import.meta.url), [scenario]);
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

test('a failed diagnostic write gets exactly one fallback attempt', async () => {
  await expect(
    invokeFixture(new URL('fixtures/output.mjs', import.meta.url), ['diagnostic-write']),
  ).resolves.toEqual({
    status: 1,
    stderr: '',
    stdout: '{"code":1,"events":[],"listeners":0,"attempts":2}\n',
  });
});

test('an action that throws an Error whose message cannot be read reports the fixed reason', async () => {
  await expect(
    invokeFixture(new URL('fixtures/output.mjs', import.meta.url), ['renderer-failed']),
  ).resolves.toEqual({
    status: 1,
    stderr: 'output: Something went wrong.\n',
    stdout: '{"code":1,"events":[],"listeners":0}\n',
  });
});

test('an unusable fallback destination still resolves the failure status', async () => {
  await expect(invokeFixture(new URL('fixtures/reporting.mjs', import.meta.url))).resolves.toEqual({
    status: 1,
    stderr: '',
    stdout: 'resolved:1\n',
  });
});

test('a call that settled is not held once the code that made it lets go of it', async () => {
  await expect(
    invokeFixture(new URL('fixtures/settled-calls.mjs', import.meta.url)),
  ).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '{"code":0,"retained":0}\n',
  });
});
