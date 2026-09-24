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

test('every descriptor publishes collect as true or false, and an undefined collect reads false', () => {
  expect(facts('layers', 'descriptors')[0]).toEqual({
    notes: true,
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
  expect(afterRecord).toMatchObject({ reader: '@fixture/after' });
});

test('a collecting read returns every value in order, frozen, and an empty list where there is none', () => {
  expect(facts('hooks', 'read')[0]).toEqual({
    bare: [],
    frozen: true,
    get: [
      { note: 'constructor' },
      { note: 'layer' },
      { note: 'first hook' },
      { note: 'second hook' },
    ],
  });
});

test('each value is validated once per build, the author layers and the hook values alike', () => {
  // Eight values reach the schema: two author layers of each extension, the option value, and one
  // Value from each of the three hooks.
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
});
