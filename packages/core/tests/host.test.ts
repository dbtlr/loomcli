import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('capture reads each override once and shares stderr with fallback reporting', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['capture-once']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    actionSawFirst: true,
    code: 1,
    first: ['Internal error: Could not write invocation output.\n'],
    hostReads: 1,
    second: [],
    stderrReads: 1,
    terminalReads: 1,
  });
});

test('automatic capture occurs at run entry and preserves argv and environment snapshots', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['capture']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    argv: ['before run', 'two words'],
    cwdMatches: true,
    env: 'at run',
    original: ['before run', 'two words'],
    streams: true,
    terminal: { stderr: { isTTY: false }, stdin: { isTTY: false }, stdout: { isTTY: false } },
  });
});

test('host overrides replace fields, copy values, and never consume stdin', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['overrides']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    args: { values: ['original'] },
    argv: ['original'],
    cwd: 'virtual-workspace',
    env: { ONLY: 'original' },
    reads: 0,
    sameInput: true,
    terminal: {
      stderr: { isTTY: false },
      stdin: { isTTY: true },
      stdout: { columns: 81, isTTY: true, rows: 25 },
    },
  });
});

test('build diagnostics use the captured output override', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['build-output'])).toEqual({
    status: 1,
    stderr: '',
    stdout: `${JSON.stringify({
      chunks: ['Invalid declaration: The root Command has no action. Register an action.\n'],
      code: 1,
    })}\n`,
  });
});

test('an application can run again with new invocation inputs', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['reuse'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'one\ntwo\n',
  });
});

test('automatic terminal capture treats zero dimensions as unavailable and retains positive sizes', () => {
  const result = invoke(new URL('fixtures/terminal.mjs', import.meta.url));
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    stderr: { columns: 100, isTTY: true },
    stdin: { isTTY: false },
    stdout: { isTTY: true, rows: 24 },
  });
});

test('environment snapshots preserve key spelling and use case-sensitive lookup on every OS', () => {
  const result = invoke(new URL('fixtures/environment.mjs', import.meta.url));
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    captured: 'captured',
    capturedUppercase: null,
    nativeUppercase: process.platform === 'win32' ? 'captured' : null,
  });
});
