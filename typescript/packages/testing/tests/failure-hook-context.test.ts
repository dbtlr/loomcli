import { UnknownCommandError } from '@loomcli/core';
import type { FailureHook, InputProblem } from '@loomcli/core';
import { describe, expect, it, test } from 'vite-plus/test';

import { failureHookContext } from '../src/index.js';

/** Points an operator at help when a command they typed is unknown. */
const hints: FailureHook = (failure, { application, invokedBy, style }) =>
  failure instanceof UnknownCommandError && invokedBy === 'argv'
    ? `Run ${style.primary(`${application} --help`)} to list the commands.`
    : undefined;

describe('failureHookContext', () => {
  it('the hook reads the facts the test stated and is called with its own failure', () => {
    const context = failureHookContext(hints, {
      application: 'notes',
      invokedBy: 'argv',
      mediaType: undefined,
      path: [],
      view: undefined,
    });
    expect(hints(new UnknownCommandError('lsit', ['list']), context)).toBe(
      'Run notes --help to list the commands.',
    );
    expect(context.path).toEqual([]);
    expect(context.view).toBeUndefined();
  });

  it('an invocation by name gets no hint', () => {
    const context = failureHookContext(hints, {
      application: 'notes',
      invokedBy: 'name',
      mediaType: 'application/json',
      path: ['list'],
      view: 'json',
    });
    expect(hints(new UnknownCommandError('lsit', ['list']), context)).toBeUndefined();
    expect(context.mediaType).toBe('application/json');
  });
});

test('received defaults to absence and accepts the reader a test states', () => {
  const values = {
    application: 'notes',
    invokedBy: 'argv',
    mediaType: undefined,
    path: [],
    view: undefined,
  } satisfies Parameters<typeof failureHookContext>[1];
  const problem = {
    input: { global: false, kind: 'option', name: 'format' },
    issues: [{ message: 'Expected JSON.' }],
    reason: 'invalid',
    spelling: '--format',
  } satisfies InputProblem;
  expect(failureHookContext(hints, values).received(problem)).toBeUndefined();
  const context = failureHookContext(hints, { ...values, received: () => 'jsno' });
  expect(context.received(problem)).toBe('jsno');
});
