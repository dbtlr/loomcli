// Acceptance plan: see packages/prompts/tests/interactive.test.ts.

import type { StandardSchemaV1 } from '@loomcli/core';
import { Application } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { multiselect, select, text } from '../src/index.js';

/** The count an option declares at run time, which the types cannot read as a literal. */
const declared = Number('2');

/** The failure a question's link ends the run with, at a terminal. */
async function failureOf(app: Application) {
  const mock = mockProcess({ terminal: { columns: 80, keys: [], rows: 24 } });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  return mock.stderr.text;
}

const oneValue = 'which is not a string option that takes one value.';

test('a text or select question refuses to link an arity option at its call', async () => {
  const scalar = new Application('link')
    .option('point', { arity: declared, type: 'string' })
    .action(async (context) => {
      await text(context, { message: 'Point', option: 'point' });
    });
  await expect(failureOf(scalar)).resolves.toContain(
    `The question "Point" links option "point", ${oneValue}`,
  );
  const several = new Application('link')
    .option('point', { arity: declared, multiple: true, type: 'string' })
    .action(async (context) => {
      await select(context, { choices: ['a'], message: 'Point', option: 'point' });
    });
  await expect(failureOf(several)).resolves.toContain(oneValue);
});

test('a multiselect question refuses to link a multiple arity option at its call', async () => {
  const app = new Application('link')
    .option('point', { arity: declared, multiple: true, type: 'string' })
    .action(async (context) => {
      await multiselect(context, { choices: ['a'], message: 'Points', option: 'point' });
    });
  await expect(failureOf(app)).resolves.toContain(
    'The question "Points" links option "point", which is not a multiple string option.',
  );
});

test('a link to an option whose validator outputs a pair compiles', () => {
  const pair: StandardSchemaV1<string, readonly [string, string]> = {
    '~standard': {
      validate: (value) => ({ value: [String(value), String(value)] as const }),
      vendor: 'test',
      version: 1,
    },
  };
  new Application('typed')
    .option('kv', { type: 'string', validate: pair })
    .action(async (context) => {
      if (context.interactive) {
        return;
      }
      void text(context, { message: 'Pair', option: 'kv' });
    });
  expect(true).toBe(true);
});
