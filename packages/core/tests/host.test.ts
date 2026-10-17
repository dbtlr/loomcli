import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('capture reads each override once and shares stderr with fallback reporting', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['capture-once']);
  expect(result.status).toBe(1);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    actionSawFirst: true,
    code: 1,
    first: ['host: Something went wrong.\n'],
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
      chunks: ['bad: Something went wrong.\n'],
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

test('automatic terminal capture reads width and height live, a zero reading as unavailable', () => {
  const result = invoke(new URL('fixtures/terminal.mjs', import.meta.url));
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
    after: {
      stderr: { isTTY: true, rows: 40 },
      stdin: { isTTY: false },
      stdout: { columns: 120, isTTY: true, rows: 24 },
    },
    before: {
      stderr: { columns: 100, isTTY: true },
      stdin: { isTTY: false },
      stdout: { isTTY: true, rows: 24 },
    },
  });
});

test('a terminal override keeps plain numbers fixed and reads a supplied getter each time', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['terminal-getter'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '{"columns":100,"rows":30}\n{"columns":60,"rows":30}\n',
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

test('host.timeZone is the zone the process resolves, which honours TZ', () => {
  const fixture = new URL('fixtures/host.mjs', import.meta.url);
  const tokyo = invoke(fixture, ['time-zone'], { env: { TZ: 'Asia/Tokyo' } });
  expect(tokyo).toEqual({ status: 0, stderr: '', stdout: 'Asia/Tokyo\n' });
  const newYork = invoke(fixture, ['time-zone'], { env: { TZ: 'America/New_York' } });
  expect(newYork).toEqual({ status: 0, stderr: '', stdout: 'America/New_York\n' });
});

test.each(['', 'UTC0', 'Bogus/Zone'])('host.timeZone falls back to UTC when TZ is %j', (zone) => {
  const fixture = new URL('fixtures/host.mjs', import.meta.url);
  const result = invoke(fixture, ['time-zone'], { env: { TZ: zone } });
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'UTC\n' });
});

test('a host override replaces the captured time zone', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['time-zone-override'], {
    env: { TZ: 'Asia/Tokyo' },
  });
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'Pacific/Auckland\n' });
});
