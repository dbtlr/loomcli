// Acceptance plan: see docs/core/validation.md, Validation options outside a run.

import { validationContext, validationOptions, WorkingDirectoryError } from '@loomcli/core';
import type { InputIdentity, SuppliedInputs, ValidationOptionsContext } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

const input: InputIdentity = { global: false, kind: 'option', name: 'at' };

test('a default phase context reads back through validationContext with the captured host', () => {
  const options = validationOptions(mockProcess({ cwd: '/work', timeZone: 'Europe/Paris' }), {
    input,
    phase: 'default',
  });
  const context = validationContext(options);
  expect(context).toEqual({ host: expect.anything(), input, phase: 'default' });
  expect([context?.host.cwd, context?.host.timeZone]).toEqual(['/work', 'Europe/Paris']);
});

test('an invocation context holds the root, no passthrough, and no supplied value when omitted', () => {
  const context = validationContext(
    validationOptions(mockProcess(), { input, phase: 'invocation' }),
  );
  expect(context).toEqual({
    command: [],
    host: expect.anything(),
    input,
    passthrough: [],
    phase: 'invocation',
    supplied: { args: {}, options: {} },
  });
});

test('a supplied record is copied, so a later change to it changes nothing', () => {
  const tags = ['a'];
  const supplied: SuppliedInputs = { args: {}, options: { tag: tags } };
  const context = validationContext(
    validationOptions(mockProcess(), {
      command: ['deploy'],
      input,
      passthrough: ['--', 'x'],
      phase: 'invocation',
      supplied,
    }),
  );
  tags.push('changed');
  expect(context).toMatchObject({
    command: ['deploy'],
    passthrough: ['--', 'x'],
    supplied: { args: {}, options: { tag: ['a'] } },
  });
});

test('the host background is the one the handle terminal states, and no query is written', () => {
  const stated = mockProcess({
    env: { TERM: 'xterm-256color' },
    terminal: { background: 'light', columns: 80, keys: [], rows: 24 },
  });
  const unstated = mockProcess({
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 80, keys: [], rows: 24 },
  });
  const read = (mock: typeof stated) =>
    validationContext(validationOptions(mock, { input, phase: 'default' }))?.host.terminal
      .background;
  expect([read(stated), read(unstated)]).toEqual(['light', undefined]);
  expect([stated.stderr.text, unstated.stderr.text]).toEqual(['', '']);
});

test('a working directory the handle cannot read throws the error a run would report', () => {
  const mock = mockProcess({
    cwd: () => {
      throw new Error('ENOENT');
    },
  });
  expect(() => validationOptions(mock, { input, phase: 'default' })).toThrow(WorkingDirectoryError);
});

test('each call builds a fresh context with a host of its own', () => {
  const mock = mockProcess();
  const one = validationContext(validationOptions(mock, { input, phase: 'default' }));
  const two = validationContext(validationOptions(mock, { input, phase: 'default' }));
  expect(one).not.toBe(two);
  expect(one?.host).not.toBe(two?.host);
});

test('the types take the default and invocation phases only, each with its own fields', () => {
  const contexts: ValidationOptionsContext[] = [
    { input, phase: 'default' },
    { command: [], input, phase: 'invocation' },
  ];
  // @ts-expect-error The question phase has its own builder, questionValidationOptions.
  const question: ValidationOptionsContext = { input, phase: 'question' };
  // @ts-expect-error A default has no Command route.
  const routed: ValidationOptionsContext = { command: [], input, phase: 'default' };
  expect([contexts, question, routed]).toHaveLength(3);
});
