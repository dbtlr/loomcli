import {
  Application,
  Command,
  FatalError,
  phrasebook,
  phrases,
  processHandle,
} from '@loomcli/core';
import { localization } from '@loomcli/plugins/localization';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

// A server whose only tool fails with a sentence of the pack's format module, under a German
// Phrasebook. The module is the fixture's own, because a phrasebook finds a sentence by its
// Package, module key, and export name.
const say = phrases('@loomcli/plugins').module('format', {
  fieldsNeedEncoding: (encodings) =>
    `Option "--fields" applies only to json output, not ${encodings.join(', ')}.`,
});

const german = phrasebook('@loomcli/plugins', {
  format: { fieldsNeedEncoding: () => 'Die Option "--fields" gilt nur für json-Ausgaben.' },
});

const fail = new Command('fail', { description: 'Fail.', extensions: [mcpCommand({})] }).action(
  () => {
    throw new FatalError(say('fieldsNeedEncoding', ['table']));
  },
);

const application = new Application('calls', {
  plugins: [mcp(), localization({ locales: { de: [german] } })],
  version: '1.0.0',
}).command(fail);

process.exitCode = await application.run({
  process: processHandle({
    argv: process.argv.slice(2),
    home: fixtureHome(),
    release: { build: 'distributed' },
  }),
});
