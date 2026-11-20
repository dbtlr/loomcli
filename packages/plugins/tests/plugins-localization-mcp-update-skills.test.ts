/*
 * Acceptance plan for the MCP, self-update, and skills plugins' localization under ADR-0200: each
 * plugin says its sentences through phrases, so a phrasebook for `@loomcli/plugins` that
 * `localization()` installs renders them in the run's language. Through public APIs and
 * `mockProcess`, under `LANG=de`:
 *
 * - MCP. A failed tool call's `content` text is the failure's report in the server's language,
 *   while its `structuredContent` keeps the English failure form.
 * - Self-update. A refusal the plugin raises prints the phrasebook's German sentence, and the run
 *   without a phrasebook prints the English one.
 * - Skills. The text view of `skills status` renders a skill's note in German, while the JSON view
 *   keeps the English note.
 */
import { Application, phrasebook } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { localization } from '@loomcli/plugins/localization';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { skills } from '@loomcli/plugins/skills';
import { expect, test } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';
import { launch, request } from '../../mcp/tests/session.js';
import { runOnMock } from './fixtures/in-process.js';

/** A German phrasebook for one sentence of two plugins. */
const pluginsDe = phrasebook('@loomcli/plugins', {
  'self-update': {
    notReleaseBinary: (name) =>
      `${name} ist kein Release-Binary und aktualisiert sich nicht selbst.`,
  },
  skills: {
    globalSkillMissing: (install) => `Führe ${install} aus, um es zu installieren.`,
  },
});

/** The localization plugin with the German phrasebook. */
const german = () => localization({ locales: { de: [pluginsDe] } });

test("a failed tool call's content follows the server's language and its structured content stays English", async () => {
  const session = launch(new URL('fixtures/mcp-localized.mjs', import.meta.url), ['mcp'], {
    env: childEnvironment({ LANG: 'de_DE.UTF-8' }),
  });
  session.send(request(1, 'tools/call', { arguments: {}, name: 'fail' }));
  const answer = await session.next();
  await session.close();
  expect(answer.result).toMatchObject({
    content: [{ text: 'Die Option "--fields" gilt nur für json-Ausgaben.\n', type: 'text' }],
    isError: true,
    structuredContent: {
      failure: { message: 'Option "--fields" applies only to json output, not table.' },
    },
  });
  expect(JSON.stringify(Object(answer.result).structuredContent)).not.toContain('Die Option');
});

/** Runs `notes self-update`, which refuses a binary that was not built as a release, in German. */
function selfUpdated(plugins: readonly Plugin[]) {
  return runOnMock(new Application('notes', { plugins }), {
    argv: ['self-update'],
    env: { LANG: 'de_DE.UTF-8' },
  });
}

/** Runs `notes skills status` for one declared skill that is not installed, in German. */
function statusIn(view: 'json' | 'text') {
  const skill = { files: () => [{ content: '# Notes', path: 'SKILL.md' }], name: 'notes' };
  return runOnMock(
    new Application('notes', { plugins: [format(), skills({ skills: [skill] }), german()] }),
    {
      argv: [
        'skills',
        'status',
        '--agent',
        'claude',
        ...(view === 'json' ? ['--format', 'json'] : []),
      ],
      env: { HOME: '/home/fixture', LANG: 'de_DE.UTF-8', XDG_STATE_HOME: '/state/fixture' },
      home: '/home/fixture',
      platform: 'linux',
      release: { build: 'source' },
    },
  );
}

test('a self-update refusal prints the phrasebook sentence, and English without it', async () => {
  const localized = await selfUpdated([selfUpdate({ notices: false }), german()]);
  expect(localized.stderr).toBe(
    'notes ist kein Release-Binary und aktualisiert sich nicht selbst.\n',
  );
  const english = await selfUpdated([selfUpdate({ notices: false })]);
  expect(english.stderr).toContain('notes was not built as a release binary');
});

test("skills status renders a note in the run's language in text, and English in JSON", async () => {
  const text = await statusIn('text');
  expect(text.stdout).toContain(
    'Führe notes skills install --agent claude aus, um es zu installieren.',
  );
  const json = await statusIn('json');
  expect(json.stdout).toContain('Run notes skills install --agent claude to install it');
});
