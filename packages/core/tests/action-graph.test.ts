import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** What the action reported about the graph and routed node it received. */
function report(scenario: string, argv: string[]) {
  const result = invoke(new URL('fixtures/action-graph.mjs', import.meta.url), [scenario, ...argv]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const frozen = { commandFrozen: true, graphFrozen: true, own: true };

test('hands an action the frozen graph and its routed node, reached through an alias', () => {
  expect(report('observed', ['cache', 'l'])).toEqual({
    ...frozen,
    name: 'observed',
    path: ['cache', 'list'],
    sameCommand: true,
    sameGraph: true,
  });
});

test('hands the root action the root node the middleware read', () => {
  expect(report('observed', [])).toEqual({
    ...frozen,
    name: 'observed',
    path: [],
    sameCommand: true,
    sameGraph: true,
  });
});

test('hands a plugin Command action the graph and its node like any other action', () => {
  expect(report('plugged', ['doctor'])).toEqual({
    ...frozen,
    name: 'plugged',
    path: ['doctor'],
    sameCommand: null,
    sameGraph: null,
  });
});
