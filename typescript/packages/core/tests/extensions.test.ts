import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

const fixture = new URL('fixtures/plugins/invoke.mjs', import.meta.url);

/** One graph whose single extension value exercises one rule of the plain-data walk. */
async function plain(scenario: string) {
  const result = await invokeFixture(new URL('fixtures/plugins/plain.mjs', import.meta.url), [
    scenario,
  ]);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

/** The fixture graph carries the same extension values whichever plugins one scenario installs. */
async function graphOf(scenario: string) {
  const result = await invokeFixture(fixture, [scenario, 'inspect']);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

const command = { details: 'Reads one value.', examples: ['get user.name'] };

test('inspect() reports each extension value keyed by its identity, frozen as plain data', async () => {
  const graph = await graphOf('facts');
  const get = graph.root.children[0];
  expect(graph.root.extensions).toEqual({
    '@fixture/facts/command': { details: 'The whole fixture.' },
  });
  expect(get.extensions).toEqual({ '@fixture/facts/command': command });
  expect(get.arguments[0].extensions).toEqual({
    '@fixture/facts/argument': { hint: 'a dot path' },
  });
  expect(get.options[0].extensions).toEqual({
    '@fixture/facts/option': { placeholder: 'raw' },
  });
  expect(graph.globals[0].extensions).toEqual({
    '@fixture/facts/option': { placeholder: 'path' },
  });
});

test('a fact whose plugin is not installed is inert and still reported', async () => {
  const inert = await graphOf('inert');
  expect(inert.root.children[0].extensions).toEqual({ '@fixture/facts/command': command });
  expect(inert).toEqual(await graphOf('facts'));
});

test('a declaration that carries no value reports an empty record', async () => {
  const graph = await graphOf('facts');
  // The "cache" group Command declares no extensions of its own.
  const cache = graph.root.children[1];
  expect(cache.name).toBe('cache');
  expect(cache.extensions).toEqual({});
});

test('readExtension returns the stored output for each node kind, and undefined for none', async () => {
  const result = await invokeFixture(fixture, ['facts', 'run', 'get', 'a.b']);
  expect(result.status).toBe(0);
  const [read] = result.stdout.split('\n');
  expect(JSON.parse(read?.slice('read:'.length) ?? '')).toEqual({
    absent: 'undefined',
    argument: { hint: 'a dot path' },
    command,
    global: { placeholder: 'path' },
    option: { placeholder: 'raw' },
    root: { details: 'The whole fixture.' },
  });
});

test('readExtension through another descriptor of one identity throws a DeclarationError', async () => {
  const result = await invokeFixture(fixture, ['facts', 'run', 'get', 'a.b']);
  expect(result.stdout.split('\n')[1]).toBe(
    'mismatch:DeclarationError:Extension "@fixture/facts/command" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.',
  );
});

test('a stored output is frozen to any depth', async () => {
  const result = await invokeFixture(fixture, ['facts', 'run', 'get', 'a.b']);
  expect(result.stdout.split('\n')[2]).toBe('frozen:[true,true]');
});

test('a "__proto__" output key is stored as an own key with the prototype untouched', async () => {
  await expect(plain('proto-key')).resolves.toEqual({
    keys: ['@fixture/plain'],
    names: ['__proto__', 'a'],
    polluted: null,
    prototype: true,
    value: { polluted: true },
  });
});

test('an output nested ten thousand deep is stored, because the walk holds no call stack', async () => {
  await expect(plain('deep')).resolves.toEqual({ depth: 10_000, keys: ['@fixture/plain'] });
});

test("a change to the author's input object after build changes nothing on the graph", async () => {
  await expect(plain('mutated')).resolves.toEqual({
    input: { list: ['one', 'two'], note: 'written' },
    stored: { list: ['one'], note: 'read' },
  });
});

test('the extensions record a node publishes is frozen', async () => {
  await expect(plain('frozen')).resolves.toEqual({ frozen: true, rejected: true });
});
