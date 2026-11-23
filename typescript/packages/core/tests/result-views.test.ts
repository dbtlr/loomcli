import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

async function reshaped(scenario: string, mode: 'inspect' | 'run') {
  return await invokeFixture(new URL('fixtures/result-views.mjs', import.meta.url), [
    scenario,
    mode,
  ]);
}

/** The result fact one scenario publishes, read back from the node the reshaping sits on. */
async function fact(scenario: string) {
  const { status, stderr, stdout } = await reshaped(scenario, 'inspect');
  expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
  return JSON.parse(stdout.slice('assembled\n'.length));
}

/** The bytes one scenario's default view wrote, which is how a run reads the merged record. */
async function written(scenario: string) {
  const { status, stderr, stdout } = await reshaped(scenario, 'run');
  expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
  return stdout.slice('assembled\n'.length, -'resolved:0\n'.length);
}

/** The sequence the declaration's own row view writes, which no reshaping in these cases changed. */
const sequence = 'PATHS\n0: one.txt\n1: two words.txt\nEND\n';

test('a replaced key keeps the position the declaration gave it', async () => {
  await expect(fact('replace')).resolves.toEqual({
    default: 'list',
    kind: 'rows',
    mediaTypes: { list: null, table: null },
    views: ['list', 'table'],
  });
  await expect(written('replace')).resolves.toBe('- one.txt\n- two words.txt\n');
});

test('a key the declaration does not hold is appended, and the default stays the first', async () => {
  await expect(fact('append')).resolves.toEqual({
    default: 'list',
    kind: 'rows',
    mediaTypes: { list: null, table: null, wide: null },
    views: ['list', 'table', 'wide'],
  });
  await expect(written('append')).resolves.toBe(sequence);
});

test('default names the view a run renders, appended in the same call', async () => {
  await expect(fact('move-default')).resolves.toEqual({
    default: 'wide',
    kind: 'rows',
    mediaTypes: { list: null, table: null, wide: null },
    views: ['list', 'table', 'wide'],
  });
  await expect(written('move-default')).resolves.toBe('wide 2\n');
});

test('a default once named persists through a later call that names none', async () => {
  await expect(fact('persist-default')).resolves.toEqual({
    default: 'wide',
    kind: 'rows',
    mediaTypes: { list: null, narrow: null, table: null, wide: null },
    views: ['list', 'table', 'wide', 'narrow'],
  });
  await expect(written('persist-default')).resolves.toBe('wide 2\n');
});

test('the same call reads on the Application, which declares the root result', async () => {
  await expect(fact('root')).resolves.toEqual({
    default: 'wide',
    kind: 'rows',
    mediaTypes: { list: null, table: null, wide: null },
    views: ['list', 'table', 'wide'],
  });
  await expect(written('root')).resolves.toBe('wide 2\n');
});

test('the call is published before the action too, and merges the same way', async () => {
  await expect(fact('before-action')).resolves.toEqual({
    default: 'list',
    kind: 'rows',
    mediaTypes: { list: null, table: null, wide: null },
    views: ['list', 'table', 'wide'],
  });
  await expect(written('before-action')).resolves.toBe(sequence);
});
