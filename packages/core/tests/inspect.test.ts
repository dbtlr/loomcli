import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The fixture encodes a declared `undefined` as this marker, which JSON alone cannot carry. */
const none = '#undefined';

function invokeInspect(graph: string, mode = 'json') {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url), [graph, mode]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const leaf = { arguments: [], children: [], hasAction: true, options: [] };

test('inspects a graph of globals, a root action, and three children', () => {
  expect(invokeInspect('jsonkit')).toEqual({
    globals: [
      {
        default: none,
        long: '--file',
        multiple: false,
        name: 'file',
        required: true,
        short: '-f',
        type: 'string',
        validated: false,
      },
      {
        long: '--quiet',
        name: 'quiet',
        negative: null,
        polarity: 'positive',
        short: '-q',
        type: 'boolean',
      },
    ],
    name: 'jsonkit',
    root: {
      arguments: [],
      children: [
        {
          ...leaf,
          arguments: [
            { default: none, name: 'path', required: true, validated: false, variadic: false },
          ],
          name: 'get',
          path: ['get'],
        },
        {
          ...leaf,
          arguments: [
            { default: none, name: 'path', required: false, validated: false, variadic: false },
          ],
          name: 'keys',
          path: ['keys'],
        },
        {
          ...leaf,
          name: 'select',
          options: [
            {
              default: none,
              long: '--field',
              multiple: true,
              name: 'field',
              required: true,
              short: '-F',
              type: 'string',
              validated: false,
            },
          ],
          path: ['select'],
        },
      ],
      hasAction: true,
      name: null,
      options: [],
      path: [],
    },
  });
});

test('inspects a group at two named levels below the root', () => {
  expect(invokeInspect('nested')).toEqual({
    globals: [],
    name: 'store',
    root: {
      arguments: [],
      children: [
        {
          arguments: [],
          children: [
            { ...leaf, name: 'clear', path: ['cache', 'clear'] },
            { ...leaf, name: 'list', path: ['cache', 'list'] },
          ],
          hasAction: false,
          name: 'cache',
          options: [],
          path: ['cache'],
        },
      ],
      hasAction: true,
      name: null,
      options: [],
      path: [],
    },
  });
});

test('reports the accepted spellings of each polarity and of a short-only option', () => {
  expect(invokeInspect('polarity').root.options).toEqual([
    {
      long: '--total',
      name: 'total',
      negative: '--no-total',
      polarity: 'both',
      short: '-t',
      type: 'boolean',
    },
    {
      long: '--color',
      name: 'color',
      negative: null,
      polarity: 'positive',
      short: null,
      type: 'boolean',
    },
    {
      long: null,
      name: 'cache',
      negative: '--no-cache',
      polarity: 'negative',
      short: null,
      type: 'boolean',
    },
    {
      default: none,
      long: null,
      multiple: false,
      name: 'mode',
      required: false,
      short: '-m',
      type: 'string',
      validated: false,
    },
  ]);
});

test('wraps a declared default and leaves an undeclared one undefined', () => {
  const root = invokeInspect('defaults').root;
  expect(root.options).toEqual([
    {
      default: { value: '1' },
      long: '--depth',
      multiple: false,
      name: 'depth',
      required: false,
      short: null,
      type: 'string',
      validated: false,
    },
    {
      default: { value: none },
      long: '--limit',
      multiple: false,
      name: 'limit',
      required: false,
      short: null,
      type: 'string',
      validated: true,
    },
    {
      default: none,
      long: '--plain',
      multiple: false,
      name: 'plain',
      required: false,
      short: null,
      type: 'string',
      validated: false,
    },
  ]);
  expect(root.arguments).toEqual([
    {
      default: { value: 'root' },
      name: 'path',
      required: false,
      validated: false,
      variadic: false,
    },
  ]);
});

test('throws a DeclarationError a consumer catches by class, without run()', () => {
  expect(invokeInspect('invalid', 'catch')).toEqual({
    caught: true,
    message: 'Command "get" has no action. Register an action.',
    name: 'DeclarationError',
  });
});

test('run() still reports the invalid graph as a diagnostic with code 1', () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url), ['invalid', 'run']);
  expect(result.stderr).toBe(
    'Invalid declaration: Command "get" has no action. Register an action.\n',
  );
  expect(JSON.parse(result.stdout)).toEqual({ code: 1 });
});

test('returns frozen data and builds a new graph on each call', () => {
  expect(invokeInspect('jsonkit', 'freeze')).toEqual({
    attempts: [
      { label: 'name', rejected: true },
      { label: 'globals', rejected: true },
      { label: 'option', rejected: true },
      { label: 'root', rejected: true },
      { label: 'children', rejected: true },
      { label: 'argument', rejected: true },
    ],
    repeats: 'jsonkit',
  });
});
