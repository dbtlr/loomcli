import { UnknownCommandError } from '@loomcli/core';
import type { FailureHook } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

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
