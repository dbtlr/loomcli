import { expect, test } from 'vite-plus/test';

import { invoke as invokeFixture } from './run-fixture.ts';

/**
 * The call that declares a fact checks it, so a faulty fact throws before any build and a valid one
 * reaches `inspect()`.
 */
async function withFact(target: string, fact: string, value: string) {
  return await invokeFixture(new URL('fixtures/facts.mjs', import.meta.url), [
    target,
    fact,
    value,
    'inspect',
  ]);
}

/** Each declaration that carries a description. */
const subjects = [
  'application',
  'command',
  'global-option',
  'option',
  'boolean-option',
  'plugin-option',
  'argument',
];

test.each(subjects)('a one-line summary on %s builds', async (target) => {
  await expect(withFact(target, 'description', 'summary')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

test('a one-line version builds', async () => {
  await expect(withFact('application', 'version', 'summary')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

/** Each declaration that carries `hidden` and `deprecated`: a named Command and an option. */
const members = ['command', 'global-option', 'option', 'boolean-option', 'plugin-option'];

test.each(members)('a one-line migration message on %s builds', async (target) => {
  await expect(withFact(target, 'deprecated', 'migration')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

test.each(
  members.flatMap((target) => [
    [target, 'true'],
    [target, 'false'],
  ]),
)('a hidden declared %s on %s builds', async (target, value) => {
  await expect(withFact(target, 'hidden', value)).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});
