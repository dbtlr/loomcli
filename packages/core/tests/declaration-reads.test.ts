import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/declaration-reads.mjs', import.meta.url);

type Call = 'application' | 'command' | 'option' | 'plugin';

/** What one fixture mode reports for one declaring call, parsed from its one line of output. */
function report(mode: string, call: Call, rest: readonly string[]): unknown {
  const result = invoke(fixture, [mode, call, ...rest]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return JSON.parse(result.stdout);
}

/**
 * Each read made to throw, by the slot its finding marks: `getter <path>` throws from the key at
 * the path, `<trap>` from a proxy over the whole declaration, and `<trap> <path>` from a proxy
 * over the value at the path. A read of the object's prototype or keys marks the whole argument,
 * and a read of one key marks that key, which for a proxy over the whole object is the first.
 */
function readsBySlot(slots: Readonly<Record<string, readonly string[]>>): Record<string, string> {
  const [first = ''] = Object.keys(slots);
  return Object.fromEntries([
    ['getPrototypeOf', '1'],
    ['ownKeys', '1'],
    ['getOwnPropertyDescriptor', `1.${first}`],
    ['get', `1.${first}`],
    ...Object.entries(slots).flatMap(([slot, specs]) =>
      [`getter ${slot}`, ...specs].map((spec) => [spec, `1.${slot}`]),
    ),
  ]);
}

/** The proxy traps a read of a nested plain object runs, with the getter on one of its keys. */
function nestedObject(path: string, key: string): string[] {
  return [
    `getter ${path}.${key}`,
    ...['getPrototypeOf', 'ownKeys', 'get'].map((trap) => `${trap} ${path}`),
  ];
}

/**
 * A list is read by its length and then index by index, so a getter on its first entry and a
 * proxy's getOwnPropertyDescriptor or get trap throw.
 */
function nestedList(path: string): string[] {
  return [`getter ${path}.0`, `getOwnPropertyDescriptor ${path}`, `get ${path}`];
}

const unreadableReads: Record<Call, { subject: string; reads: Record<string, string> }> = {
  application: {
    reads: readsBySlot({
      description: [],
      extensions: nestedList('extensions'),
      plugins: nestedList('plugins'),
      rendering: nestedObject('rendering', 'color'),
      translators: nestedList('translators'),
      version: [],
      views: nestedList('views'),
    }),
    subject: 'The Application options',
  },
  command: {
    reads: readsBySlot({
      deprecated: [],
      description: [],
      extensions: nestedList('extensions'),
      hidden: [],
    }),
    subject: 'Command "get" options',
  },
  option: {
    reads: readsBySlot({
      default: [],
      description: [],
      extensions: nestedList('extensions'),
      type: [],
    }),
    subject: 'Option "format" config',
  },
  plugin: {
    reads: readsBySlot({
      commands: nestedList('commands'),
      extensions: nestedList('extensions'),
      middleware: [
        ...nestedObject('middleware', 'activate'),
        'getter middleware.load',
        ...nestedList('middleware.activate'),
      ],
      onCommandAttach: [],
      onFailure: [],
      options: nestedObject('options', 'level'),
      signals: nestedList('signals'),
      source: [...nestedObject('source', 'load'), 'getter source.binding'],
      theme: nestedObject('theme', 'highlight'),
      translators: nestedList('translators'),
      views: nestedList('views'),
    }),
    subject: 'Plugin "@acme/probe" definition',
  },
};

/** Each call's outcomes, read from one fixture run per call. */
const outcomes = new Map<Call, unknown>();

function outcomeOf(call: Call, spec: string): unknown {
  if (!outcomes.has(call)) {
    outcomes.set(call, report('unreadable', call, Object.keys(unreadableReads[call].reads)));
  }
  const reported = outcomes.get(call);
  return typeof reported === 'object' && reported !== null
    ? Reflect.get(reported, spec)
    : undefined;
}

test.each(
  (['application', 'command', 'option', 'plugin'] as const).flatMap((call) =>
    Object.entries(unreadableReads[call].reads).map(([spec, mark]) => ({ call, mark, spec })),
  ),
)(
  'a $call declaration read that throws ($spec) is unreadable at the call, marking $mark',
  ({ call, mark, spec }) => {
    expect(outcomeOf(call, spec)).toEqual({
      cause: true,
      mark: [mark],
      rule: '@loomcli/core/unreadable-declaration',
      sentence: `${unreadableReads[call].subject} could not be read: boom.`,
    });
  },
);

test('a plugin option config whose extensions list throws is unreadable, marking the list', () => {
  expect(report('unreadable', 'plugin', ['getter options.level.extensions.0'])).toEqual({
    'getter options.level.extensions.0': {
      cause: true,
      mark: ['1.options.level.extensions'],
      rule: '@loomcli/core/unreadable-declaration',
      sentence: 'Plugin "@acme/probe" option "level" config could not be read: boom.',
    },
  });
});

/** Each call's top-level slots, and the nested parts of them the once mode counts. */
const countedReads: Record<
  Exclude<Call, 'option'>,
  { slots: readonly string[]; nested: readonly string[] }
> = {
  application: {
    nested: ['extensions.0', 'plugins.0', 'rendering.color', 'translators.0', 'views.0'],
    slots: ['description', 'extensions', 'plugins', 'rendering', 'translators', 'version', 'views'],
  },
  command: {
    nested: ['extensions.0'],
    slots: ['deprecated', 'description', 'extensions', 'hidden'],
  },
  plugin: {
    nested: [
      'commands.0',
      'extensions.0',
      'middleware.activate',
      'middleware.activate.0',
      'middleware.load',
      'options.level',
      'signals.0',
      'source.binding',
      'source.load',
      'theme.highlight',
      'translators.0',
      'views.0',
    ],
    slots: [
      'commands',
      'extensions',
      'middleware',
      'onCommandAttach',
      'onFailure',
      'options',
      'signals',
      'source',
      'theme',
      'translators',
      'views',
    ],
  },
};

test.each(['plugin', 'application', 'command'] as const)(
  'each part of a %s declaration is read once across the call and the graph build',
  (call) => {
    const { nested, slots } = countedReads[call];
    expect(report('once', call, nested)).toEqual({
      ended: 'returned',
      reads: Object.fromEntries([...slots, ...nested].map((path) => [path, 1])),
    });
  },
);

test.each(['plugin', 'application', 'command', 'option'] as const)(
  'a %s declaration runs each proxy trap at most once per key across the call and the graph build',
  (call) => {
    expect(report('traps', call, [])).toEqual({ ended: 'returned', twice: [], unread: [] });
  },
);

test.each([
  { call: 'plugin', rule: '@loomcli/core/invalid-identity' },
  { call: 'application', rule: '@loomcli/core/portable-name' },
  { call: 'command', rule: '@loomcli/core/portable-name' },
  { call: 'option', rule: '@loomcli/core/declared-name' },
  { call: 'argument', rule: '@loomcli/core/declared-name' },
  { call: 'global', rule: '@loomcli/core/declared-name' },
] as const)(
  'a $call with an invalid name reports the name and reads none of its declaration',
  ({ call, rule }) => {
    expect(invoke(fixture, ['name', call])).toEqual({
      status: 0,
      stderr: '',
      stdout: `${JSON.stringify({ reads: 0, rule })}\n`,
    });
  },
);

/** The fact each call's graph reads back from its declaration. */
const facts: Record<Call, unknown> = {
  application: 'Probe the reads.',
  command: 'Get one.',
  option: { value: 'plain' },
  plugin: ['level'],
};

test.each(['plugin', 'application', 'command', 'option'] as const)(
  'a %s declaration reads an own key that is not enumerable',
  (call) => {
    expect(report('hidden', call, [])).toEqual({ ended: 'returned', fact: facts[call] });
  },
);

test.each(
  (
    [
      { call: 'plugin', path: '' },
      { call: 'application', path: '' },
      { call: 'command', path: '' },
      { call: 'application', path: 'rendering' },
      { call: 'plugin', path: 'middleware' },
    ] as const
  ).flatMap(({ call, path }) =>
    (['throws', 'array'] as const).map((second) => ({ call, path, second })),
  ),
)(
  'a $call declaration whose part "$path" reads plain once and then $second is judged once',
  ({ call, path, second }) => {
    expect(report('flip', call, [path, second])).toEqual({ ended: 'returned', fact: facts[call] });
  },
);

test('a plain verdict one declaring call reached answers no later declaring call', () => {
  expect(report('later', 'application', [])).toEqual({
    after: 'returned',
    before: expect.objectContaining({ rule: '@loomcli/core/rendering-policy' }),
    reused: expect.objectContaining({ rule: '@loomcli/core/not-an-object' }),
  });
});

test('a list is read by its length once and index by index, never through its own methods', () => {
  expect(report('lists', 'plugin', [])).toEqual({
    ended: 'returned',
    forEachCalls: 0,
    installed: 'returned',
    lengthReads: 1,
  });
});
