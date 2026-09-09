import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/plugins/invoke.mjs', import.meta.url);

/** The fixture graph carries the same extension values whichever plugins one scenario installs. */
function graphOf(scenario: string) {
  const result = invoke(fixture, [scenario, 'inspect']);
  expect(result.stderr).toBe('');
  return JSON.parse(result.stdout);
}

const command = { details: 'Reads one value.', examples: ['get user.name'] };

test('inspect() reports each extension value keyed by its identity, frozen as plain data', () => {
  const graph = graphOf('facts');
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

test('a fact whose plugin is not installed is inert and still reported', () => {
  const inert = graphOf('inert');
  expect(inert.root.children[0].extensions).toEqual({ '@fixture/facts/command': command });
  expect(inert).toEqual(graphOf('facts'));
});

test('a declaration that carries no value reports an empty record', () => {
  const graph = graphOf('facts');
  expect(graph.root.children[0].options[0].extensions).not.toEqual({});
  expect(graph.root.arguments).toEqual([]);
  expect(graph.root.options).toEqual([]);
});

test('readExtension returns the stored output for each node kind, and undefined for none', () => {
  const result = invoke(fixture, ['facts', 'run', 'get', 'a.b']);
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

test('readExtension through another descriptor of one identity throws a DeclarationError', () => {
  const result = invoke(fixture, ['facts', 'run', 'get', 'a.b']);
  expect(result.stdout.split('\n')[1]).toBe(
    'mismatch:DeclarationError:Extension "@fixture/facts/command" was read through a descriptor that did not define the stored value. Install one copy of the package that defines it.',
  );
});

test('a stored output is frozen to any depth', () => {
  const result = invoke(fixture, ['facts', 'run', 'get', 'a.b']);
  expect(result.stdout.split('\n')[2]).toBe('frozen:[true,true]');
});
