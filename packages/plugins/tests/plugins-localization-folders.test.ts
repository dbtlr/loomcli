/*
 * Acceptance plan for the plugin pack's localization of the background, completion, dotenv,
 * external-commands, logging, manpage, and service folders (docs/plugins/localization.md), under
 * ADR-0200: one sentence of each folder renders in German under `LANG=de` through a phrasebook for
 * `@loomcli/plugins` that `localization()` installs, and the same run is English without a
 * phrasebook entry. Through public APIs and `mockProcess`.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, Command, escapeControlCharacters, phrasebook } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { completion } from '@loomcli/plugins/completion';
import { dotenv } from '@loomcli/plugins/dotenv';
import { externalCommands } from '@loomcli/plugins/external-commands';
import { localization } from '@loomcli/plugins/localization';
import { logging } from '@loomcli/plugins/logging';
import { manpage } from '@loomcli/plugins/manpage';
import { service } from '@loomcli/plugins/service';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

const shown = escapeControlCharacters;

/** A German phrasebook for one sentence of each folder. */
const pluginsDe = phrasebook('@loomcli/plugins', {
  background: { backgroundIssue: 'Gib dark oder light an.' },
  completion: {
    shellUnknown: (name) => `${shown(name)} kennt diese Shell nicht. Nenne eine Shell.`,
  },
  dotenv: {
    lineMalformed: (name, line, file) =>
      `${shown(name)} in Zeile ${String(line)} von ${shown(file)} übersprungen.`,
  },
  'external-commands': {
    cannotRun: (application, program) =>
      `${shown(application)} kann ${shown(program)} nicht starten.`,
  },
  logging: { badLevel: (name, value) => `${shown(name)}=${shown(value)} ist keine Stufe.` },
  manpage: { notAFolder: (name, folder) => `${shown(name)}: ${shown(folder)} ist kein Ordner.` },
  service: {
    platformUnsupported: (name, platform) =>
      `${shown(name)} kann auf ${shown(platform)} keinen Dienst ausführen.`,
  },
});

/** Runs the application on a mock with the words and fields, under `LANG=de` unless the env says. */
async function ran(
  app: { run: Application['run'] },
  argv: readonly string[],
  fields: Parameters<typeof mockProcess>[0] = {},
) {
  const mock = mockProcess({
    argv: [...argv],
    ...fields,
    env: { LANG: 'de_DE.UTF-8', ...fields.env },
  });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text };
}

/** The localization plugin with the German phrasebook. */
const german = () => localization({ locales: { de: [pluginsDe] } });

/** Runs a case in a fresh directory, and removes it after. */
async function inDirectory(body: (directory: string) => Promise<void>): Promise<void> {
  const directory = mkdtempSync(join(tmpdir(), 'loom-plugins-localization-'));
  try {
    await body(directory);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test("the background plugin's issue renders in the run's language", async () => {
  const app = new Application('notes', { plugins: [background(), german()] }).action(() => {});
  const { code, stderr } = await ran(app, ['--background=blue']);
  expect(code).toBe(2);
  expect(stderr).toContain('Gib dark oder light an.');
});

test("the completion plugin's failure renders in the run's language", async () => {
  const app = new Application('notes', { plugins: [completion(), german()] });
  const { stderr } = await ran(app, ['completion', 'install'], { env: { SHELL: '/bin/ksh' } });
  expect(stderr).toContain('kennt diese Shell nicht. Nenne eine Shell.');
});

test("the dotenv plugin's warning renders in the run's language", async () => {
  await inDirectory(async (directory) => {
    writeFileSync(join(directory, '.env'), 'NEXT bad\n');
    const app = new Application('notes', { plugins: [dotenv(), german()] }).action(() => {});
    const { stderr } = await ran(app, [], { cwd: directory });
    expect(stderr).toContain('NEXT in Zeile 1 von .env übersprungen.');
  });
});

test("the external-commands plugin's failure renders in the run's language", async () => {
  await inDirectory(async (directory) => {
    const program = join(directory, 'notes-foo');
    writeFileSync(program, '#!/bin/sh\n', { mode: 0o755 });
    const app = new Application('notes', {
      plugins: [externalCommands(), german()],
    }).command(new Command('add').action(() => {}));
    const { code, stderr } = await ran(app, ['foo'], {
      env: { PATH: directory },
      programs: {
        [program]: () => {
          throw Object.assign(new Error('spawn EACCES'), { code: 'EACCES' });
        },
      },
    });
    expect(code).toBe(1);
    expect(stderr).toContain(`notes kann ${program} nicht starten.`);
  });
});

test("the logging plugin's warning renders in the run's language", async () => {
  await inDirectory(async (directory) => {
    const app = new Application('notes', {
      plugins: [logging({ file: join(directory, 'notes.log') }), german()],
    }).action(({ log }) => {
      log.info('Indexed.');
    });
    const { stderr } = await ran(app, [], {
      env: { HOME: directory, NOTES_LOG_LEVEL: 'loud', XDG_STATE_HOME: directory },
      home: directory,
    });
    expect(stderr).toContain('NOTES_LOG_LEVEL=loud ist keine Stufe.');
  });
});

test("the manpage plugin's failure renders in the run's language", async () => {
  await inDirectory(async (directory) => {
    const file = join(directory, 'man');
    writeFileSync(file, 'a file\n');
    const app = new Application('notes', { plugins: [manpage(), german()] });
    const { stderr } = await ran(app, ['manpage', 'generate', '--out', 'man'], { cwd: directory });
    expect(stderr).toContain(`notes: ${file} ist kein Ordner.`);
  });
});

test("the service plugin's failure renders in the run's language", async () => {
  const app = new Application('notes', {
    plugins: [service({ label: 'com.acme.notes', run: ['serve'] }), german()],
  }).command(new Command('serve', { description: 'Serve.' }).action(() => {}));
  const { stderr } = await ran(app, ['service', 'status'], { platform: 'win32' });
  expect(stderr).toContain('notes kann auf win32 keinen Dienst ausführen.');
});
