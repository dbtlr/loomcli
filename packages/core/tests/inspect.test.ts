import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The fixture encodes a declared `undefined` as this marker, which JSON alone cannot carry. */
const none = '#undefined';

/** A declaration that carries no extension value reports the empty record, never a missing key. */
const bare = { extensions: {} };

/** An option the application declared, global or local, reports the application scope. */
const owned = { extensions: {}, scope: 'application' };

function invokeInspect(graph: string, mode = 'json') {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url), [graph, mode]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

const leaf = {
  aliases: [],
  arguments: [],
  children: [],
  description: none,
  extensions: {},
  hasAction: true,
  options: [],
};

test('inspects a graph of globals, a root action, and three children', () => {
  expect(invokeInspect('jsonkit')).toEqual({
    description: none,
    globals: [
      {
        ...owned,
        default: none,
        description: none,
        long: '--file',
        multiple: false,
        name: 'file',
        required: true,
        short: '-f',
        type: 'string',
        validateOmitted: false,
        validated: false,
      },
      {
        ...owned,
        description: none,
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
      aliases: [],
      arguments: [],
      children: [
        {
          ...leaf,
          arguments: [
            {
              ...bare,
              default: none,
              description: none,
              name: 'path',
              required: true,
              validateOmitted: false,
              validated: false,
              variadic: false,
            },
          ],
          name: 'get',
          path: ['get'],
        },
        {
          ...leaf,
          arguments: [
            {
              ...bare,
              default: none,
              description: none,
              name: 'path',
              required: false,
              validateOmitted: false,
              validated: false,
              variadic: false,
            },
          ],
          name: 'keys',
          path: ['keys'],
        },
        {
          ...leaf,
          name: 'select',
          options: [
            {
              ...owned,
              default: none,
              description: none,
              long: '--field',
              multiple: true,
              name: 'field',
              required: true,
              short: '-F',
              type: 'string',
              validateOmitted: false,
              validated: false,
            },
          ],
          path: ['select'],
        },
      ],
      description: none,
      extensions: {},
      hasAction: true,
      name: null,
      options: [],
      path: [],
    },
    version: none,
  });
});

test('reports the version and every declared description, and the root reports the graph one', () => {
  expect(invokeInspect('described')).toEqual({
    description: 'Reads a JSON document.',
    globals: [
      {
        ...owned,
        default: none,
        description: 'The document to read.',
        long: '--file',
        multiple: false,
        name: 'file',
        required: false,
        short: '-f',
        type: 'string',
        validateOmitted: false,
        validated: false,
      },
    ],
    name: 'described',
    root: {
      aliases: [],
      arguments: [],
      children: [
        {
          aliases: [],
          arguments: [
            {
              ...bare,
              default: none,
              description: 'The path to read.',
              name: 'path',
              required: true,
              validateOmitted: false,
              validated: false,
              variadic: false,
            },
          ],
          children: [],
          description: 'Reads one value.',
          extensions: {},
          hasAction: true,
          name: 'get',
          options: [
            {
              ...owned,
              description: 'Prints the value unquoted.',
              long: '--raw',
              name: 'raw',
              negative: null,
              polarity: 'positive',
              short: null,
              type: 'boolean',
            },
          ],
          path: ['get'],
        },
      ],
      description: 'Reads a JSON document.',
      extensions: {},
      hasAction: true,
      name: null,
      options: [],
      path: [],
    },
    version: '1.2.0',
  });
});

test('inspects a group at two named levels below the root', () => {
  expect(invokeInspect('nested')).toEqual({
    description: none,
    globals: [],
    name: 'store',
    root: {
      aliases: [],
      arguments: [],
      children: [
        {
          aliases: ['c'],
          arguments: [],
          children: [
            { ...leaf, name: 'clear', path: ['cache', 'clear'] },
            { ...leaf, aliases: ['ls', 'l'], name: 'list', path: ['cache', 'list'] },
          ],
          description: none,
          extensions: {},
          hasAction: false,
          name: 'cache',
          options: [],
          path: ['cache'],
        },
      ],
      description: none,
      extensions: {},
      hasAction: true,
      name: null,
      options: [],
      path: [],
    },
    version: none,
  });
});

test('reports the accepted spellings of each polarity and of a short-only option', () => {
  expect(invokeInspect('polarity').root.options).toEqual([
    {
      ...owned,
      description: none,
      long: '--total',
      name: 'total',
      negative: '--no-total',
      polarity: 'both',
      short: '-t',
      type: 'boolean',
    },
    {
      ...owned,
      description: none,
      long: '--color',
      name: 'color',
      negative: null,
      polarity: 'positive',
      short: null,
      type: 'boolean',
    },
    {
      ...owned,
      description: none,
      long: null,
      name: 'cache',
      negative: '--no-cache',
      polarity: 'negative',
      short: null,
      type: 'boolean',
    },
    {
      ...owned,
      default: none,
      description: none,
      long: null,
      multiple: false,
      name: 'mode',
      required: false,
      short: '-m',
      type: 'string',
      validateOmitted: false,
      validated: false,
    },
  ]);
});

test('reads each spelling role from the table, including a name that begins with "no-"', () => {
  expect(invokeInspect('roles').root.options).toEqual([
    {
      ...owned,
      description: none,
      long: '--no-color',
      name: 'no-color',
      negative: '--no-no-color',
      polarity: 'both',
      short: '-n',
      type: 'boolean',
    },
    {
      ...owned,
      default: none,
      description: none,
      long: null,
      multiple: true,
      name: 'field',
      required: false,
      short: '-F',
      type: 'string',
      validateOmitted: false,
      validated: false,
    },
  ]);
});

test('wraps a declared default and leaves an undeclared one undefined', () => {
  const root = invokeInspect('defaults').root;
  expect(root.options).toEqual([
    {
      ...owned,
      default: { value: '1' },
      description: none,
      long: '--depth',
      multiple: false,
      name: 'depth',
      required: false,
      short: null,
      type: 'string',
      validateOmitted: false,
      validated: false,
    },
    {
      ...owned,
      default: { value: none },
      description: none,
      long: '--limit',
      multiple: false,
      name: 'limit',
      required: false,
      short: null,
      type: 'string',
      validateOmitted: false,
      validated: true,
    },
    {
      ...owned,
      default: none,
      description: none,
      long: '--plain',
      multiple: false,
      name: 'plain',
      required: false,
      short: null,
      type: 'string',
      validateOmitted: false,
      validated: false,
    },
  ]);
  expect(root.arguments).toEqual([
    {
      ...bare,
      default: { value: 'root' },
      description: none,
      name: 'path',
      required: false,
      validateOmitted: false,
      validated: false,
      variadic: false,
    },
  ]);
});

test('reports the option and the argument that validate their own omission', () => {
  const root = invokeInspect('omission').root;
  expect(root.options).toEqual([
    {
      ...owned,
      default: none,
      description: none,
      long: '--file',
      multiple: false,
      name: 'file',
      required: false,
      short: null,
      type: 'string',
      validateOmitted: true,
      validated: true,
    },
    {
      ...owned,
      default: none,
      description: none,
      long: '--size',
      multiple: false,
      name: 'size',
      required: false,
      short: null,
      type: 'string',
      validateOmitted: false,
      validated: true,
    },
  ]);
  expect(root.arguments).toEqual([
    {
      ...bare,
      default: none,
      description: none,
      name: 'path',
      required: false,
      validateOmitted: true,
      validated: true,
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

test('reports an optional variadic argument with its declared default', () => {
  expect(invokeInspect('tails').root.arguments).toEqual([
    {
      ...bare,
      default: { value: ['a'] },
      description: none,
      name: 'files',
      required: false,
      validateOmitted: false,
      validated: false,
      variadic: true,
    },
  ]);
});

test.each([
  ['nonboolean-variadic', 'Argument "files" variadic must be Boolean. Use true or false.'],
  ['nonboolean-required', 'Option "size" required must be Boolean. Use true or false.'],
  ['nonboolean-omitted', 'Option "file" validateOmitted must be Boolean. Use true or false.'],
  ['numeric-omitted', 'Option "file" validateOmitted must be Boolean. Use true or false.'],
  ['null-omitted', 'Option "file" validateOmitted must be Boolean. Use true or false.'],
  ['undefined-omitted', 'Option "file" validateOmitted must be Boolean. Use true or false.'],
  [
    'required-default',
    'Option "depth" is required and declares a default. Remove the default or make the input optional.',
  ],
  [
    'boolean-validate',
    'Option "total" is Boolean. Remove validate, default, required, and validateOmitted; use polarity to control its absent value.',
  ],
  [
    'boolean-default',
    'Option "total" is Boolean. Remove validate, default, required, and validateOmitted; use polarity to control its absent value.',
  ],
  [
    'foreign-schema',
    'Option "size" validate must be a Standard Schema v1 object. Supply a compatible schema.',
  ],
  [
    'multiple-default',
    'Option "field" default must be an array of strings without a schema. Supply a string array default.',
  ],
] satisfies [string, string][])(
  'inspect() rejects the %s declaration, as run() does',
  (graph, message) => {
    expect(invokeInspect(graph, 'catch')).toEqual({
      caught: true,
      message,
      name: 'DeclarationError',
    });
    const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url), [graph, 'run']);
    expect(result.stderr).toBe(`Invalid declaration: ${message}\n`);
    expect(JSON.parse(result.stdout)).toEqual({ code: 1 });
  },
);

test('inspect() leaves a default that only its schema rejects to run()', () => {
  expect(invokeInspect('schema-default', 'catch')).toEqual({ caught: false });
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url), [
    'schema-default',
    'run',
  ]);
  expect(result.stderr).toBe(
    'Invalid declaration: Option "depth" has an invalid default. Fix the default or its schema.\nOption "depth": Use decimal digits.\n',
  );
  expect(JSON.parse(result.stdout)).toEqual({ code: 1 });
});

test('run() still reports the invalid graph as a diagnostic with code 1', () => {
  const result = invoke(new URL('fixtures/inspect.mjs', import.meta.url), ['invalid', 'run']);
  expect(result.stderr).toBe(
    'Invalid declaration: Command "get" has no action. Register an action.\n',
  );
  expect(JSON.parse(result.stdout)).toEqual({ code: 1 });
});

test('copies and freezes a declared default that has no prototype', () => {
  expect(invokeInspect('bare', 'default')).toEqual({ rejected: true, value: { depth: '1' } });
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
      { label: 'aliases', rejected: true },
    ],
    repeats: 'jsonkit',
  });
});
