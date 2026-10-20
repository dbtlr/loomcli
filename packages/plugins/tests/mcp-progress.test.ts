import { expect, test } from 'vite-plus/test';

import { progressMessage, progressRelay } from '../src/mcp/progress.js';

test('a completed without a total writes the count alone', () => {
  expect(progressMessage({ completed: 3, id: 1, label: 'Fetching', state: 'updated' })).toBe(
    'Fetching 3 (updated)',
  );
});

test('a total without a completed writes no counts', () => {
  expect(progressMessage({ id: 1, label: 'Fetching', state: 'started', total: 8 })).toBe(
    'Fetching (started)',
  );
});

test("each number reads as JavaScript's String writes it", () => {
  expect(progressMessage({ completed: 0.5, id: 1, label: '', state: 'updated', total: 1e21 })).toBe(
    '0.5/1e+21 (updated)',
  );
});

test('a relay counts every event it sends, whatever its counts, and sends no total', () => {
  const sent: unknown[] = [];
  const relay = progressRelay((update) => {
    sent.push(update);
  });
  relay({ completed: 3, id: 1, label: 'a', state: 'updated', total: 3 });
  relay({ completed: 3, id: 1, label: 'a', state: 'ended', total: 3 });
  relay({ id: 2, label: 'b', state: 'started' });
  expect(sent).toEqual([
    { message: 'a 3/3 (updated)', progress: 1 },
    { message: 'a 3/3 (ended)', progress: 2 },
    { message: 'b (started)', progress: 3 },
  ]);
});
