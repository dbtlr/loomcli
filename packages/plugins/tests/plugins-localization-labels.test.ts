/*
 * Acceptance plan for the fixed record labels of three text views (docs/plugins/localization.md),
 * under ADR-0200: the service status view, the skills status view, and the extended version block
 * print each label through a phrasebook for `@loomcli/plugins`, and the value column stays aligned
 * when a translated label is longer or shorter than the English one, because the padding reads the
 * rendered labels.
 */
import { Application, nowrap, phrasebook, style } from '@loomcli/core';
import type { Phrase } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { localization } from '@loomcli/plugins/localization';
import { skills } from '@loomcli/plugins/skills';
import { version } from '@loomcli/plugins/version';
import { expect, test } from 'vite-plus/test';

import { servicePhrase } from '../src/service/phrases.js';
import { stateOf, statusOf, statusText } from '../src/service/status.js';
import { runOnMock } from './fixtures/in-process.js';

/** A German phrasebook for the labels of the three views, one longer than its English label. */
const pluginsDe = phrasebook('@loomcli/plugins', {
  service: { logLabel: 'Protokoll', noteLabel: 'Hinweis', unitLabel: 'Einheit' },
  skills: { changedLabel: 'geändert', folderLabel: 'Verzeichnis', noteLabel: 'Hinweis' },
  version: {
    assetLabel: 'Datei',
    buildLabel: 'Bau',
    channelLabel: 'Kanal',
    installationMethodLabel: 'Installationsart',
    platformLabel: 'Plattform',
    runtimeLabel: 'Laufzeit',
  },
});

/** The localization plugin with the German phrasebook. */
const german = () => localization({ locales: { de: [pluginsDe] } });

test('the service status text view prints its labels in German and aligns the values', () => {
  const labels = new Map<string, string>([
    ['unit', 'Einheit'],
    ['note', 'Hinweis'],
  ]);
  const localize = (phrase: Phrase): string => labels.get(phrase.text) ?? phrase.text;
  const state = stateOf(
    { installed: true, label: 'com.acme.notes', unit: '/units/a.service' },
    {
      notes: [servicePhrase('noSessionNote', 'com.acme.notes')],
      pid: 9,
      running: true,
      state: 'active',
    },
  );
  const status = statusOf(state, [{ name: 'connections', value: '3' }]);
  const lines = statusText(status, style, localize).split('\n');
  expect(lines[1]).toBe(`  Einheit      ${nowrap('/units/a.service')}`);
  expect(lines[2]).toBe('  connections  3');
  expect(lines[3]?.startsWith('  Hinweis      ')).toBe(true);
});

test('the service status text view pads a wide label by its display width', () => {
  const labels = new Map<string, string>([['unit', '設備']]);
  const localize = (phrase: Phrase): string => labels.get(phrase.text) ?? phrase.text;
  const state = stateOf(
    { installed: true, label: 'com.acme.notes', unit: '/u' },
    { notes: [], running: true, state: 'active' },
  );
  const lines = statusText(
    statusOf(state, [{ name: 'health', value: 'ok' }]),
    style,
    localize,
  ).split('\n');
  // 設備 is two characters four columns wide, so it pads like a four-letter label.
  expect(lines[1]).toBe(`  設備    ${nowrap('/u')}`);
  expect(lines[2]).toBe('  health  ok');
});

test('the skills status text view prints its labels in German and aligns the values', async () => {
  const skill = { files: () => [{ content: '# Notes', path: 'SKILL.md' }], name: 'notes' };
  const { stdout } = await runOnMock(
    new Application('notes', { plugins: [format(), skills({ skills: [skill] }), german()] }),
    {
      argv: ['skills', 'status', '--agent', 'claude'],
      env: { HOME: '/home/fixture', LANG: 'de_DE.UTF-8', XDG_STATE_HOME: '/state/fixture' },
      home: '/home/fixture',
      platform: 'linux',
      release: { build: 'source' },
    },
  );
  const rows = stdout.split('\n').filter((line) => line.startsWith('  '));
  expect(rows[0]).toMatch(/^ {2}Verzeichnis {2}\S/);
  expect(rows[1]).toMatch(/^ {2}Hinweis {6}\S/);
  expect(stdout).not.toContain('folder');
});

test('the extended version block prints its labels in German and aligns the values', async () => {
  const { stdout } = await runOnMock(
    new Application('notes', {
      plugins: [format(), version({ extended: true }), german()],
      version: '1.1.0',
    }).action(() => {}),
    {
      argv: ['--version'],
      env: { LANG: 'de_DE.UTF-8', NO_COLOR: '1' },
      release: { build: 'source' },
      runtime: { name: 'bun', version: '1.3.2' },
    },
  );
  const labels = ['Kanal', 'Bau', 'Datei', 'Installationsart', 'Laufzeit', 'Plattform'];
  const rows = stdout.split('\n').slice(1, 7);
  const width = 'Installationsart'.length + 2;
  expect(rows.map((row) => row.slice(0, width))).toEqual(
    labels.map((label) => label.padEnd(width)),
  );
  expect(stdout).not.toContain('platform');
});
