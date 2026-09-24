import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/collecting.mjs', import.meta.url);

/** The facts one scenario wrote, one JSON value per line. */
function facts(scenario: string, mode: string): unknown[] {
  const result = invoke(fixture, [scenario, mode]);
  expect(result.stderr).toBe('');
  return result.stdout
    .split('\n')
    .filter((line) => line !== '')
    .map((line): unknown => JSON.parse(line));
}

test('a collecting extension keeps every author layer in order, where an ordinary one keeps the last', () => {
  expect(facts('layers', 'inspect')[0]).toEqual({
    bare: {},
    get: {
      '@fixture/notes/command': [{ note: 'constructor' }, { note: 'layer' }],
      '@fixture/single/command': { note: 'layer' },
    },
    raw: { '@fixture/notes/option': [{ note: 'option' }] },
  });
});

test('every descriptor publishes collect as given, false where it is omitted or undefined', () => {
  expect(facts('layers', 'descriptors')[0]).toEqual({
    notes: true,
    null: null,
    single: false,
    undefined: false,
  });
});

test('hooks supply values after the author layers, in installation order, and replace an ordinary value', () => {
  expect(facts('hooks', 'inspect')[0]).toEqual({
    bare: {},
    get: {
      '@fixture/notes/command': [
        { note: 'constructor' },
        { note: 'layer' },
        { note: 'first hook' },
        { note: 'second hook' },
      ],
      '@fixture/single/command': { note: 'hook' },
    },
    raw: { '@fixture/notes/option': [{ note: 'option' }] },
  });
});

test('a hook reads the author values and every earlier hook value, typed and as the published record', () => {
  const [before, beforeRecord, after, afterRecord] = facts('reads', 'inspect');
  expect(before).toEqual({
    notes: [{ note: 'constructor' }, { note: 'layer' }],
    reader: '@fixture/before',
    single: { note: 'layer' },
  });
  expect(beforeRecord).toEqual({
    reader: '@fixture/before',
    record: {
      '@fixture/notes/command': [{ note: 'constructor' }, { note: 'layer' }],
      '@fixture/single/command': { note: 'layer' },
    },
    same: true,
  });
  expect(after).toEqual({
    notes: [{ note: 'constructor' }, { note: 'layer' }, { note: 'first hook' }],
    reader: '@fixture/after',
    single: { note: 'layer' },
  });
  expect(afterRecord).toEqual({
    reader: '@fixture/after',
    record: {
      '@fixture/notes/command': [
        { note: 'constructor' },
        { note: 'layer' },
        { note: 'first hook' },
      ],
      '@fixture/single/command': { note: 'layer' },
    },
    same: true,
  });
});

test('a collecting read returns every value in order, frozen, and a frozen empty list where there is none', () => {
  const [read, foreign] = facts('hooks', 'read');
  expect(foreign).toEqual({
    foreign: 'DeclarationError',
    message:
      'Extension "@fixture/notes/command" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.',
  });
  expect(read).toEqual({
    bare: [],
    emptyFrozen: true,
    frozen: true,
    get: [
      { note: 'constructor' },
      { note: 'layer' },
      { note: 'first hook' },
      { note: 'second hook' },
    ],
  });
});

test('a hook that replaces an ordinary value leaves its key where it first appeared', () => {
  expect(facts('keys', 'keys')[0]).toEqual(['@fixture/single/command', '@fixture/notes/command']);
});

test('a hook that declares an option and then extends keeps both', () => {
  expect(facts('option-then-extend', 'options')[0]).toEqual({
    notes: [{ note: 'constructor' }, { note: 'layer' }, { note: 'hook' }],
    options: ['raw', 'extra'],
  });
});

test('each value is validated once per build, the author layers and the hook values alike', () => {
  // Eight values reach the schema, and each reaches it once.
  // Two author layers of each extension, the option value, and one value from each of three hooks.
  expect(facts('hooks', 'calls')[0]).toEqual({ calls: 8 });
});

test('one layer holds one value of a collecting extension, in a declaration and in one extend() call', () => {
  const twice = 'holds extension "@fixture/notes/command" twice. Supply one value.';
  expect(facts('twice-in-layer', 'fault')[0]).toEqual({
    fault: 'DeclarationError',
    message: `Command "get" ${twice}`,
  });
  expect(facts('twice-in-call', 'fault')[0]).toEqual({
    fault: 'DeclarationError',
    message: `The root Command ${twice}`,
  });
});

test('a value a hook passes to extend() is rejected at the call, and a hook that catches continues', () => {
  const invalid =
    'Command "get" holds an invalid "@fixture/notes/command" value: Supply a note. Correct the value.';
  expect(facts('rejected', 'fault')[0]).toEqual({ fault: 'DeclarationError', message: invalid });
  const [caught, graph] = facts('caught', 'inspect');
  expect(caught).toEqual({ caught: 'DeclarationError', message: invalid });
  expect(graph).toMatchObject({
    get: {
      '@fixture/notes/command': [{ note: 'constructor' }, { note: 'layer' }],
      '@fixture/single/command': { note: 'after the catch' },
    },
  });
});

test('extend() rejects a second descriptor of one identity at the call', () => {
  expect(facts('twin-at-call', 'fault')[0]).toEqual({
    fault: 'DeclarationError',
    message:
      'Extension "@fixture/notes/command" is defined twice. Install one copy of the package that defines it.',
  });
});

test('a rejected extend() call the hook catches registers none of its descriptors', () => {
  expect(facts('rejected-twin', 'fault')[0]).toEqual({ fault: null });
});

test('an invalid author value is reported before a hook on that Command runs', () => {
  expect(facts('author-first', 'fault')[0]).toEqual({
    fault: 'DeclarationError',
    message:
      'Command "get" holds an invalid "@fixture/notes/command" value: Supply a note. Correct the value.',
  });
});

test('build rejects a descriptor whose collect is neither true nor false', () => {
  const rejected = {
    fault: 'DeclarationError',
    message:
      'Extension "@fixture/hand/command" declares collect that is not a Boolean. Supply true or false, or build the descriptor with extension(identity, config).',
  };
  expect(facts('hand-yes', 'fault')[0]).toEqual(rejected);
  expect(facts('hand-absent', 'fault')[0]).toEqual(rejected);
  expect(facts('hand-false', 'fault')[0]).toEqual({ fault: null });
  const factory = {
    ...rejected,
    message: rejected.message.replace('@fixture/hand/', '@fixture/factory/'),
  };
  expect(facts('factory-null', 'fault')[0]).toEqual(factory);
  expect(facts('factory-yes', 'fault')[0]).toEqual(factory);
});
