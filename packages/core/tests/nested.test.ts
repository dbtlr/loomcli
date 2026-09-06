import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

interface Report {
  args: Record<string, unknown>;
  command: string;
  options: Record<string, unknown>;
  passthrough: string[];
}

function invokeNested(argv: string[]) {
  // The fixture prefix prevents Bun from consuming a leading passthrough delimiter.
  return invoke(new URL('fixtures/nested.mjs', import.meta.url), ['invoke', ...argv]);
}

function report(argv: string[]): Report {
  const result = invokeNested(argv);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

test.each([
  [['cache', 'clear'], 'clear', { force: false }],
  [['cache', 'clear', '--force'], 'clear', { force: true }],
  [['cache', 'clear', '-F'], 'clear', { force: true }],
  [['cache', 'list'], 'list', {}],
  [['store', 'put'], 'put', {}],
] satisfies [string[], string, Record<string, unknown>][])(
  'routes %j through the named levels to its leaf with the globals and its own locals',
  (argv, command, options) => {
    expect(report(['--file', 'data.json', ...argv])).toEqual({
      args: {},
      command,
      options: { file: 'data.json', ...options },
      passthrough: [],
    });
  },
);

test.each([
  [[], 'root', {}],
  [['store'], 'store', { pretty: false }],
  [['store', '--pretty'], 'store', { pretty: true }],
] satisfies [string[], string, Record<string, unknown>][])(
  'runs the action of the Command %j selects, children and all',
  (argv, command, options) => {
    expect(report(['--file', 'data.json', ...argv])).toEqual({
      args: {},
      command,
      options: { file: 'data.json', ...options },
      passthrough: [],
    });
  },
);
