/*
 * Acceptance plan for a community validator package that localizes its issues through the public
 * `issueCode` (ADR-0048, ADR-0200), built on public APIs alone:
 *
 * - An issue code whose `message` returns a phrase renders in German under a phrasebook with
 *   `LANG=de`, and in English without one.
 * - An issue code whose `message` returns a string builds the literal issue.
 */
import { Application, phrasebook, phrases, plugin } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { createValidator, issueCode } from '../src/index.js';

const common = {
  expectedEven: (value: number) => `Expected an even number, not ${String(value)}.`,
};

declare module '@loomcli/core' {
  interface MessagePackages {
    readonly '@acme/validators': { readonly common: typeof common };
  }
}

const say = phrases('@acme/validators').module('common', common);

const evenIssue = issueCode('@acme/validators/even', {
  message: ({ value }) => say('expectedEven', value),
  schema: z.object({ value: z.number() }),
});

const plainIssue = issueCode('@acme/validators/plain', {
  message: ({ value }) => `Plain ${String(value)}.`,
  schema: z.object({ value: z.number() }),
});

const even = createValidator({
  parse: (raw) => {
    const value = Number(raw);
    return value % 2 === 0 ? { value } : { issues: [evenIssue.issue({ value })] };
  },
});

const acmeDe = phrasebook('@acme/validators', {
  common: { expectedEven: (value: number) => `Erwartet eine gerade Zahl, nicht ${String(value)}.` },
});

function registry(translated: boolean) {
  return new Application('registry', {
    plugins: translated ? [plugin('acme-de', { phrasebooks: { de: [acmeDe] } })] : [],
  })
    .option('count', { type: 'string', validate: even })
    .action(() => undefined);
}

async function ran(translated: boolean, env: Record<string, string>) {
  const mock = mockProcess({ argv: ['--count', '3'], env });
  const code = await registry(translated).run({ process: mock });
  return { code, stderr: mock.stderr.text };
}

test('a community package renders its phrase in German under a phrasebook', async () => {
  await expect(ran(true, { LANG: 'de_DE.UTF-8' })).resolves.toEqual({
    code: 2,
    stderr: 'registry: Option "--count": Erwartet eine gerade Zahl, nicht 3.\n',
  });
});

test('a community package renders English without a phrasebook', async () => {
  const expected = {
    code: 2,
    stderr: 'registry: Option "--count": Expected an even number, not 3.\n',
  };
  await expect(ran(false, { LANG: 'de_DE.UTF-8' })).resolves.toEqual(expected);
  await expect(ran(true, {})).resolves.toEqual(expected);
});

test('a phrase message builds an issue equal to the literal issue', () => {
  expect(evenIssue.issue({ value: 3 })).toEqual({
    code: '@acme/validators/even',
    message: 'Expected an even number, not 3.',
    params: { value: 3 },
  });
});

test('a string message builds the literal issue', () => {
  expect(plainIssue.issue({ value: 3 })).toStrictEqual({
    code: '@acme/validators/plain',
    message: 'Plain 3.',
    params: { value: 3 },
  });
});
