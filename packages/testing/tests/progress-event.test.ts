import type { ProgressEvent } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';

import { progressEvent } from '../src/index.js';

/** Reports a finished event's share of its total as a percentage, or nothing. */
function percent({ completed, state, total }: ProgressEvent): string | undefined {
  return state === 'ended' && completed !== undefined && total !== undefined
    ? `${Math.round((completed / total) * 100)}%`
    : undefined;
}

describe('progressEvent', () => {
  it('an unstated member takes its fixed default', () => {
    expect(progressEvent()).toEqual({ id: 1, label: '', state: 'updated' });
    expect(Object.keys(progressEvent())).not.toContain('completed');
    expect(Object.keys(progressEvent())).not.toContain('total');
  });

  it('an observer reads the members the test stated', () => {
    expect(percent(progressEvent({ completed: 3, state: 'ended', total: 4 }))).toBe('75%');
    expect(percent(progressEvent({ completed: 3, total: 4 }))).toBeUndefined();
  });

  it('a stated member replaces its default whole, and the event is frozen', () => {
    const event = progressEvent({ id: 7, label: 'Fetching', state: 'started' });
    expect(event).toEqual({ id: 7, label: 'Fetching', state: 'started' });
    expect(Object.isFrozen(event)).toBe(true);
  });
});
