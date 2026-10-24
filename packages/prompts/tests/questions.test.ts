// Acceptance plan: see packages/prompts/tests/interactive.test.ts.

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('a linked question returns the validated supplied option silently without prompt validation', () => {
  const result = invoke(new URL('fixtures/questions.mjs', import.meta.url), [
    'linked',
    '--port',
    '8080',
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toBe('8080\n');
});

test.each(['empty', 'unknown', 'global', 'multiple', 'count', 'content', 'confirm-string'])(
  'malformed questions fail at their call with the question declaration rule: %s',
  (scenario) => {
    const result = invoke(new URL('fixtures/faults.mjs', import.meta.url), [scenario]);
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      name: 'DeclarationError',
      rule: '@loomcli/prompts/link',
    });
  },
);

test('a select question with no choices states its fault and its correction', () => {
  const result = invoke(new URL('fixtures/faults.mjs', import.meta.url), ['empty']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    correction: 'Supply at least one choice.',
    name: 'DeclarationError',
    rule: '@loomcli/prompts/link',
    sentence: 'The select question "Mode" has no choices.',
  });
});

test('a missing linked value reports an ordinary usage failure', () => {
  const result = invoke(new URL('fixtures/questions.mjs', import.meta.url), ['missing']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain(
    'Option "--port" is required when input is not interactive. Supply a value.',
  );
});

test('an unlinked question cannot resolve without interaction', () => {
  const result = invoke(new URL('fixtures/questions.mjs', import.meta.url), ['unlinked']);
  expect(result.status).toBe(1);
  expect(result.stderr).toContain(
    'The question "Name" needs an interactive terminal, and this run is not interactive. Run "setup" at a terminal.',
  );
});

test.each([
  ['named-linked', { output: '8080\n', status: 'completed' }],
  [
    'named-missing',
    {
      exitCode: 2,
      form: { message: 'Option "port" is required when input is not interactive. Supply a value.' },
      status: 'failed',
    },
  ],
  ['named-unlinked', { exitCode: 1, form: { code: 'interaction-unavailable' }, status: 'failed' }],
  [
    'named-boolean-missing',
    {
      exitCode: 2,
      form: {
        message: 'Option "install" is required when input is not interactive. Supply a value.',
      },
      status: 'failed',
    },
  ],
])('invocation by name uses the same noninteractive question rules: %s', (scenario, outcome) => {
  const result = invoke(new URL('fixtures/questions.mjs', import.meta.url), [scenario]);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject(outcome);
});

test.each(['abort', 'eof', 'ctrl-c', 'ctrl-backslash'])(
  'an embedding host cancels and synchronously restores terminal input on %s',
  (scenario) => {
    const result = invoke(new URL('fixtures/host.mjs', import.meta.url), [scenario]);
    expect(result.status).toBe(130);
    expect(result.stderr).toBe('');
    const observed = JSON.parse(result.stdout);
    expect(observed).toMatchObject({
      code: 130,
      listeners: [0, 0, 0, 0],
      modes: [true, false],
      output: '',
      paused: true,
      raw: false,
    });
    expect(observed.messages).toContain('cancelled');
    expect(observed.messages).toContain('\u001b[?25h');
    expect(observed.abortRestored).toBe(scenario === 'abort');
  },
);

test('Ctrl-Z on a stdin that is not the process terminal does nothing, and the question goes on', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['ctrl-z']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ code: 0, output: '8080\n', raw: false });
});

test('a frame override can add rows while secret text stays out of view data', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['secret']);
  expect(result.status).toBe(0);
  const observed = JSON.parse(result.stdout);
  expect(observed).toMatchObject({
    code: 0,
    listeners: [0, 0, 0, 0],
    output: 'secret-value\n',
    raw: false,
    secretVisible: false,
  });
  expect(observed.messages).toContain('extra row');
  expect(observed.messages).toContain('\r\u001b[1A\u001b[J');
  expect(observed.messages).not.toContain('secret-value');
});

test.each([
  ['callable', 'HELLO'],
  ['path', '/workspace/notes.txt'],
  ['dateTime', '2026-10-15T08:30:00.000Z'],
])('question validation passes the captured host context to %s', (scenario, output) => {
  const result = invoke(new URL('fixtures/context.mjs', import.meta.url), [scenario]);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({ code: 0, output });
});
