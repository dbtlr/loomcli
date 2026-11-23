/*
 * Acceptance plan for the validators package's localization (ADR-0200), through public APIs, a
 * fixture Application, and `mockProcess`:
 *
 * - A run under `LANG=de` with a phrasebook for `@loomcli/validators` renders the rejected value's
 *   `InputError` line in the phrasebook's sentence, and a sentence the phrasebook omits in English.
 * - Run outside Loom as a plain Standard Schema validator, an issue still equals its literal form.
 * - A phrasebook for the package refuses a sentence name it does not have and a wrong parameter
 *   type.
 */
import { Application, phrasebook, plugin } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { port, text } from '../src/index.js';

const validatorsDe = phrasebook('@loomcli/validators', {
  common: {
    expectedLengthRange: (min, max) => `Erwartet ${String(min)} bis ${String(max)} Zeichen.`,
  },
});

const german = () => plugin('validators-de', { phrasebooks: { de: [validatorsDe] } });

/** An application whose options read a short text and a port. */
function registry() {
  return new Application('registry', { plugins: [german()] })
    .option('name', { type: 'string', validate: text({ maxLength: 3 }) })
    .option('port', { type: 'string', validate: port() })
    .action(() => undefined);
}

async function ran(argv: readonly string[], env: Record<string, string>) {
  const mock = mockProcess({ argv: [...argv], env });
  const code = await registry().run({ process: mock });
  return { code, stderr: mock.stderr.text };
}

test('a rejected value renders the phrasebook sentence under a German locale', async () => {
  await expect(ran(['--name', 'abcd'], { LANG: 'de_DE.UTF-8' })).resolves.toEqual({
    code: 2,
    stderr: 'registry: Option "--name": Erwartet 1 bis 3 Zeichen.\n',
  });
});

test('a sentence the phrasebook omits, and a run in English, render English', async () => {
  const omitted = await ran(['--port', 'x'], { LANG: 'de_DE.UTF-8' });
  expect(omitted.stderr).toBe(
    'registry: Option "--port": Expected a port number from 1 through 65535.\n',
  );
  const english = await ran(['--name', 'abcd'], {});
  expect(english.stderr).toBe('registry: Option "--name": Expected from 1 through 3 characters.\n');
});

test('outside Loom a validator answers the literal issue', () => {
  expect(text({ maxLength: 3 })['~standard'].validate('abcd')).toEqual({
    issues: [
      {
        code: '@loomcli/validators/text-length-range',
        message: 'Expected from 1 through 3 characters.',
        params: { max: 3, min: 1 },
      },
    ],
  });
  expect(port()['~standard'].validate('x')).toEqual({
    issues: [
      {
        code: '@loomcli/validators/port',
        message: 'Expected a port number from 1 through 65535.',
        params: {},
      },
    ],
  });
});

test('a phrasebook for the package refuses a wrong sentence name and a wrong parameter type', () => {
  phrasebook('@loomcli/validators', {
    common: {
      // @ts-expect-error TS2561: a misspelled sentence.
      expectedLengthRang: 'x',
    },
  });
  phrasebook('@loomcli/validators', {
    common: {
      // @ts-expect-error TS2322: a parameter of the wrong type.
      expectedLengthRange: (min: string) => min,
    },
  });
  expect(true).toBe(true);
});
