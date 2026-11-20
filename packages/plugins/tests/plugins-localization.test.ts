/*
 * Acceptance plan for the plugin pack's localization (docs/plugins/localization.md), under ADR-0200:
 * the pack's sentences and help's fixed labels render in the run's language through a phrasebook
 * for `@loomcli/plugins` that `localization()` installs. Through public APIs and `mockProcess`:
 *
 * - Under `LANG=de`, help prints a heading the phrasebook holds in German and one it omits in
 *   English, and without the plugin the same page is English.
 * - A format plugin failure prints its German sentence, and core's frame around an issue stays
 *   English when only the plugin pack's phrasebook is installed.
 * - The suggestions plugin's fix replaces the issue inside core's line and renders in German.
 * - Every subpath entry's declarations load the pack's registry member, so
 *   `phrasebook('@loomcli/plugins', …)` compiles for an author who imports any one of them.
 */
import { readFile } from 'node:fs/promises';

import { Application, Command, escapeControlCharacters, phrasebook } from '@loomcli/core';
import type { View } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { localization } from '@loomcli/plugins/localization';
import { suggestions } from '@loomcli/plugins/suggestions';
import { mockProcess } from '@loomcli/testing';
import { oneOf } from '@loomcli/validators';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** A German phrasebook for a few of the pack's sentences and labels. */
const pluginsDe = phrasebook('@loomcli/plugins', {
  format: {
    fieldsNeedEncoding: () =>
      'Die Option "--fields" gilt nur für json- und jsonl-Ausgaben. Entferne --fields.',
    formatIssue: (names) => `Gib eines von ${names.map(escapeControlCharacters).join(', ')} an.`,
  },
  help: {
    childHint: (command) => `Befehlsdetails zeigt ${command}.`,
    commandsHeading: 'BEFEHLE',
    repeatableFact: 'wiederholbar',
    usageHeading: 'VERWENDUNG',
  },
  suggestions: {
    valueSuggestion: (name) => `Meintest du "${escapeControlCharacters(name)}"?`,
  },
});

/** The localization plugin with the German phrasebook. */
const german = () => localization({ locales: { de: [pluginsDe] } });

/** An application with a Command whose option repeats and whose result the formatter encodes. */
function notes(localized: boolean) {
  const table: View<unknown> = { render: () => 'notes\n' };
  const list = new Command('list', { description: 'List notes.' })
    .option('tag', { description: 'Filter by tag.', multiple: true, type: 'string' })
    .result({ views: { table } })
    .action(({ out }) => out.results({ title: 'Groceries' }));
  const plugins = [help(), format(), ...(localized ? [german()] : [])];
  return new Application('notes', { plugins }).command(list);
}

/** Runs an application with the words and environment given, and returns what each stream holds. */
async function ran(
  app: { run: Application['run'] },
  argv: readonly string[],
  env: Record<string, string> = { LANG: 'de_DE.UTF-8' },
) {
  const mock = mockProcess({ argv: [...argv], env });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

test("help prints a heading the phrasebook holds in the run's language", async () => {
  const { stdout } = await ran(notes(true), ['list', '--help']);
  expect(stdout).toContain('VERWENDUNG');
  expect(stdout).not.toContain('USAGE');
  expect(stdout).toContain('(wiederholbar)');
});

test('help closes with a hint the phrasebook words as a whole sentence around the command', async () => {
  const localized = await ran(notes(true), ['--help']);
  expect(localized.stdout).toContain('Befehlsdetails zeigt notes <command> --help.\n');
  expect(localized.stdout).not.toContain('for command details.');
  const english = await ran(notes(false), ['--help']);
  expect(english.stdout).toContain('Run notes <command> --help for command details.\n');
});

test('help prints a heading the phrasebook omits in English', async () => {
  const { stdout } = await ran(notes(true), ['list', '--help']);
  expect(stdout).toContain('OPTIONS');
  expect(stdout).toContain('GLOBAL OPTIONS');
});

test('without the localization plugin the help page is the English page', async () => {
  const english = await ran(notes(false), ['list', '--help']);
  expect(english.stdout).toContain('USAGE');
  expect(english.stdout).toContain('(repeatable)');
  const localized = await ran(notes(true), ['list', '--help']);
  expect(
    localized.stdout.replace('VERWENDUNG', 'USAGE').replaceAll('wiederholbar', 'repeatable'),
  ).toBe(english.stdout);
});

test("a format plugin failure prints the phrasebook's German sentence", async () => {
  const { code, stderr } = await ran(notes(true), ['list', '--fields', 'name']);
  expect(code).toBe(2);
  expect(stderr).toContain(
    'notes: Die Option "--fields" gilt nur für json- und jsonl-Ausgaben. Entferne --fields.',
  );
});

test("an issue the pack reports renders in German inside core's English frame", async () => {
  const { code, stderr } = await ran(notes(true), ['list', '--format', 'yaml']);
  expect(code).toBe(2);
  expect(stderr).toContain('notes: Option "--format": Gib eines von table, json, jsonl an.');
});

test("the suggestions plugin's fix replaces the issue inside core's line, in German", async () => {
  const app = new Application('kit', { plugins: [suggestions(), german()] })
    .option('mode', { type: 'string', validate: oneOf(['json', 'yaml']) })
    .action(() => {});
  const { code, stderr } = await ran(app, ['--mode', 'jsno']);
  expect(code).toBe(2);
  expect(stderr).toBe('kit: Option "--mode": Meintest du "json"?\n');
  const english = await ran(app, ['--mode', 'jsno'], {});
  expect(english.stderr).toBe('kit: Option "--mode": Did you mean "json"?\n');
});

/** The manifest's exports map, each subpath with its declaration file. */
const manifestSchema = z.object({ exports: z.record(z.string(), z.object({ types: z.string() })) });

/** The declaration file of each subpath the pack's manifest exports. */
async function entryDeclarations(): Promise<{ entry: string; text: string }[]> {
  const manifest = manifestSchema.parse(
    JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')),
  );
  return Promise.all(
    Object.entries(manifest.exports).map(async ([entry, { types }]) => ({
      entry,
      text: await readFile(new URL(`../${types}`, import.meta.url), 'utf8'),
    })),
  );
}

test("every subpath's declarations load the pack's registry member", async () => {
  const declarations = await entryDeclarations();
  expect(declarations.length).toBeGreaterThan(0);
  const missing = declarations
    // An entry re-exports no name from the registry, or, as the localization entry does, its member's type.
    .filter(({ text }) => !/^export type \{[^}]*\} from '(?:\.\.?\/)+registry\.js';$/mu.test(text))
    .map(({ entry }) => entry);
  expect(missing).toEqual([]);
});

/** An application whose one child sits in the authored section the argument names, if any. */
function withChild(section: Parameters<typeof helpCommand>[0]['section']) {
  const child = new Command('list', {
    description: 'List notes.',
    extensions: section === undefined ? [] : [helpCommand({ section })],
  }).action(() => {});
  return new Application('notes', { plugins: [help(), german()] }).command(child);
}

test('help prints an authored section named like a fallback heading as written, not translated', async () => {
  const authored = await ran(withChild(['Commands']), ['--help']);
  expect(authored.stdout).toContain('COMMANDS');
  expect(authored.stdout).not.toContain('BEFEHLE');
  const fallback = await ran(withChild(undefined), ['--help']);
  expect(fallback.stdout).toContain('BEFEHLE');
  expect(fallback.stdout).not.toContain('COMMANDS');
});
