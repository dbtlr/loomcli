import { expect, test } from 'vite-plus/test';

import { requiredStdin } from '../src/commands/command.js';
import type { Content } from '../src/inputs/content.js';

test('required stdin that arrives unprepared throws at the accessor', () => {
  expect(() => requiredStdin(undefined)).toThrow('Required stdin was not prepared.');
});

test('required stdin that was prepared is read as the Content', () => {
  const content: Content = {
    kind: 'stdin',
    name: 'stdin',
    path: undefined,
    stream: () => {
      throw new Error('unread');
    },
    text: async () => '',
  };
  expect(requiredStdin(content)).toBe(content);
});
