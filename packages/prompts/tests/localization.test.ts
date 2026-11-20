import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  Application,
  escapeControlCharacters,
  phrasebook,
  phrasedIssue,
  phrases,
  plugin,
} from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import { plain } from '@loomcli/plugins/plain';
import { confirm, multiselect, progress, select, text } from '@loomcli/prompts';
import type { ProgressContext, PromptContext } from '@loomcli/prompts';
import { key, mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

const validation = { unavailable: 'Not available on this plan.' };

declare module '@loomcli/core' {
  interface MessagePackages {
    readonly 'prompts-test': { readonly validation: typeof validation };
  }
}

const validatorPhrase = phrases('prompts-test').module('validation', validation);

function german() {
  return plugin('german', {
    phrasebooks: {
      de: [
        phrasebook('@loomcli/prompts', {
          common: {
            interactionUnavailable: (question: string, command: string) =>
              `Die Frage „${escapeControlCharacters(question)}“ braucht ein Terminal. Führe „${escapeControlCharacters(command)}“ am Terminal aus.`,
            logLinesDropped: (dropped: number) => `Verworfene Zeilen: ${String(dropped)}.`,
            selectKeys: '↑↓ bewegen · Enter auswählen',
            yesOrNo: 'Tippe y oder n.',
          },
        }),
        phrasebook('prompts-test', {
          validation: { unavailable: 'In diesem Tarif nicht verfügbar.' },
        }),
      ],
    },
  });
}

function app(action: (context: ProgressContext & PromptContext<unknown>) => Promise<void>) {
  return new Application('setup', {
    plugins: [plain(), interaction(), german()],
    rendering: { color: 'never', modifiers: 'never' },
  }).action(action);
}

test('the prompts entry exposes the phrasebook types to a consumer', () => {
  const project = fileURLToPath(new URL('type-consumer/tsconfig.json', import.meta.url));
  // The fixture is compiled alone so another test cannot bring the augmentation into scope.
  const result = spawnSync('pnpm', ['exec', 'tsc', '-p', project], {
    encoding: 'utf8',
    timeout: 15_000,
  });
  expect(result.error).toBeUndefined();
  expect({ output: result.stdout + result.stderr, status: result.status }).toEqual({
    output: '',
    status: 0,
  });
});

test('a question without a terminal reports the failure in German', async () => {
  const mock = mockProcess({ env: { LANG: 'de' } });
  const setup = app(async (context) => {
    await text(context, { message: 'Project name' });
  });
  await expect(setup.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toBe(
    'Die Frage „Project name“ braucht ein Terminal. Führe „setup“ am Terminal aus.\n',
  );
});

test('a live list shows its key hint in German', async () => {
  const mock = mockProcess({
    env: { LANG: 'de' },
    terminal: { columns: 80, keys: ['\r'], rows: 24 },
  });
  const setup = app(async (context) => {
    await select(context, { choices: ['Local'], message: 'Backend' });
  });
  await expect(setup.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toContain('↑↓ bewegen · Enter auswählen');
});

test("a live question's frame shows a validator issue in German", async () => {
  const mock = mockProcess({
    env: { LANG: 'de' },
    terminal: {
      columns: 80,
      keys: [`Telemetry${key.enter}${key.backspace.repeat(9)}Backups${key.enter}`],
      rows: 24,
    },
  });
  const setup = app(async (context) => {
    await text(context, {
      message: 'Feature',
      validate: {
        '~standard': {
          validate: (value) =>
            value === 'Telemetry'
              ? { issues: [phrasedIssue(validatorPhrase('unavailable'))] }
              : { value: String(value) },
          vendor: 'fixture',
          version: 1,
        },
      },
    });
  });
  await expect(setup.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toContain('✘ In diesem Tarif nicht verfügbar.');
  expect(mock.stderr.text).not.toContain('Not available on this plan.');
});

test('line-by-line questions localize rejected answers and fall back per sentence', async () => {
  const mock = mockProcess({
    env: { ACCESSIBLE: '1', LANG: 'de' },
    terminal: { columns: 80, keys: ['?\ry\r0\r1\r'], rows: 24 },
  });
  const setup = app(async (context) => {
    await confirm(context, { message: 'Continue?' });
    await select(context, { choices: ['Local'], message: 'Backend' });
  });
  await expect(setup.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toContain('Tippe y oder n.');
  expect(mock.stderr.text).toContain('Type a number from 1 to 1.');
});

test('a progress failure localizes the dropped-lines notice above the kept log', async () => {
  const mock = mockProcess({ env: { LANG: 'de' } });
  const setup = app(async (context) => {
    const line = progress(context, { label: 'Building', logLimit: 1 });
    await line.log('discarded\nkept');
    await line.fail();
  });
  await expect(setup.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toContain('  Verworfene Zeilen: 1.\n  kept\n');
});

test('a linked multiselect repeats a localized validator issue inside its English choice line', async () => {
  const mock = mockProcess({
    env: { ACCESSIBLE: '1', LANG: 'de' },
    terminal: { columns: 80, keys: ['1\r2\r'], rows: 24 },
  });
  const setup = new Application('setup', { plugins: [plain(), interaction(), german()] })
    .option('feature', {
      multiple: true,
      type: 'string',
      validate: {
        '~standard': {
          validate: (value) =>
            value === 'Telemetry'
              ? { issues: [phrasedIssue(validatorPhrase('unavailable'))] }
              : { value: String(value) },
          vendor: 'fixture',
          version: 1,
        },
      },
    })
    .action(async (context) => {
      await multiselect(context, {
        choices: ['Telemetry', 'Backups'],
        message: 'Features',
        option: 'feature',
      });
    });
  await expect(setup.run({ process: mock })).resolves.toBe(0);
  expect(mock.stderr.text).toContain('✘ Telemetry: In diesem Tarif nicht verfügbar.');
});
