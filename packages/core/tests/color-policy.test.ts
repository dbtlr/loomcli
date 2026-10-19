import { expect, test } from 'vite-plus/test';

import { chosenPolicy, uncapturedPolicy } from '../src/color.js';

test('a marked Application whose host capture failed prints with color off and nothing else set', () => {
  expect(uncapturedPolicy(true)).toEqual({ color: 'never' });
});

test('an Application with no mark sets nothing early when its host capture failed', () => {
  expect(uncapturedPolicy(false)).toEqual({});
});

test('the choice sets the color field alone over the declared policy, and no choice keeps it', () => {
  const declared = { color: 'always', hyperlinks: 'never', modifiers: 'never' } as const;
  expect(chosenPolicy(declared, 'never')).toEqual({
    color: 'never',
    hyperlinks: 'never',
    modifiers: 'never',
  });
  expect(chosenPolicy(declared, undefined)).toEqual(declared);
});
