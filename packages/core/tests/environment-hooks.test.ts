import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/environment-hooks.mjs', import.meta.url);

test('environment hooks compose before defaults, bound inputs, and middleware read the host', () => {
  const result = invoke(fixture, ['timing']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toEqual({
    events: [
      'first',
      'second:imported',
      'default:imported',
      'invocation:imported',
      'middleware:imported',
    ],
    options: { check: 'default', token: 'imported' },
  });
});

test('existing and empty environment values win, while undefined values may be filled', () => {
  const result = invoke(fixture, ['precedence']);
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    env: { EMPTY: '', SET: 'shell', UNDEFINED: 'file' },
  });
});

test.each(['not-record', 'bad-value', 'bad-name', 'nul'])(
  'a malformed hook answer is an ordinary plugin defect: %s',
  (answer) => {
    const result = invoke(fixture, ['invalid', answer]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('@loomcli/core/broken-environment-hook');
    expect(result.stderr).not.toContain('secret-value');
    expect(result.stdout).toBe('');
  },
);

test('inspection and checking do not prepare an environment', () => {
  expect(invoke(fixture, ['inspect'])).toMatchObject({ status: 0, stderr: '', stdout: '[]\n' });
});

test('an action invocation inherits the environment without repeating preparation', () => {
  const result = invoke(fixture, ['nested'], { env: { LOOM_DOTENV_TOKEN: undefined } });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    nested: { messages: '', output: 'imported\n', status: 'completed' },
    process: null,
  });
  expect(
    JSON.parse(result.stdout).events.filter((event: string) => event === 'first'),
  ).toHaveLength(1);
});

test.each(['before', 'during'])(
  'cancellation %s preparation prevents process additions and later hooks',
  (when) => {
    const result = invoke(fixture, ['cancel', when], { env: { LOOM_DOTENV_TOKEN: undefined } });
    expect(result.status).toBe(130);
    expect(result.stderr).not.toContain('failed');
    const received = JSON.parse(result.stdout);
    expect(received.process).toBeNull();
    expect(received.events.some((event: string) => event.startsWith('second:'))).toBe(false);
    expect(received.events.includes('first')).toBe(when === 'during');
  },
);

test.each([
  ['process-argv', 'imported'],
  ['process-env', null],
  ['process-cwd', null],
  ['process-name', null],
])('only an argv run without cwd or env overrides publishes additions: %s', (scenario, value) => {
  const result = invoke(fixture, [scenario], { env: { LOOM_DOTENV_TOKEN: undefined } });
  expect(result).toMatchObject({ status: 0, stderr: '' });
  expect(JSON.parse(result.stdout)).toMatchObject({
    options: { token: 'imported' },
    process: value,
  });
});
