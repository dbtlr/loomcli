import { doctor } from '@loom/doctor';
import { explain } from '@loom/explain';
import { explainCommand } from '@loom/explain/extension';
import { Application, FatalError, override } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { helpInput, helpCommand } from '@loomcli/plugins/help/extension';
import { manifest } from '@loomcli/plugins/manifest';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';
import { records } from '@loomcli/plugins/records';
import { suggestions } from '@loomcli/plugins/suggestions';
import { loomTheme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';

import packet from '../loom.packet.json' with { type: 'json' };
import Package from '../package.json' with { type: 'json' };
import { summarize } from './actions/summarize.js';
import { debug } from './commands/debug.js';
import { fetch } from './commands/fetch.js';
import { get } from './commands/get.js';
import { keys } from './commands/keys.js';
import { paths } from './commands/paths.js';
import { select } from './commands/select.js';
import { readFailures } from './failures.js';
import type { Member } from './member.js';
import { invalidJson } from './translators.js';
import { fatalError } from './views.js';

// The root action type-imports this value, so it is registered by the last call.
const configured = new Application('jsonkit', {
  description: 'Read and reshape one JSON document.',
  extensions: [
    helpCommand({
      commandSections: [
        ['Document commands', 'Read'],
        ['Document commands', 'Reshape'],
        ['Commands'],
      ],
      details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
      examples: [{ command: '-f doc.json' }, { command: 'get user.name -f doc.json' }],
    }),
    explainCommand({
      details: 'With no subcommand, jsonkit summarizes the document and its top-level keys.',
      examples: ['jsonkit -f doc.json', 'jsonkit get user.name -f doc.json'],
    }),
    // The root action summarizes the document, so it reads one.
    manifestCommand({ failures: readFailures }),
    mcpCommand({ annotations: { openWorld: false, readOnly: true } }),
  ],
  // The source tree reads development; the build writes distributed into the bundle.
  packet,
  plugins: [
    help(),
    suggestions(),
    version(),
    format({ short: 'o' }),
    manifest({ short: 'M' }),
    loomTheme(),
    explain(),
    doctor(),
    completion(),
    mcp(),
  ],
  translators: [invalidJson],
  version: Package.version,
  views: [override(FatalError, fatalError)],
})
  .globalOption('file', {
    description: 'The document to read. Omit it to read piped text.',
    extensions: [helpInput({ placeholder: 'path' })],
    short: 'f',
    type: 'string',
  })
  .globalOption('verbose', {
    description: 'Name the document before reading it.',
    short: 'v',
    type: 'count',
  });

declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const jsonkit = configured
  .command(get)
  .command(keys)
  .command(select)
  .command(fetch)
  .command(debug)
  .command(paths)
  .rows<Member>({ views: { records: records({ identifier: 'key' }) } })
  .action(summarize);
