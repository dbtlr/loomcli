import { readFileSync } from 'node:fs';

import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

import { changelog } from './commands/changelog/command.js';
import { pr } from './commands/pr/command.js';
import { release } from './commands/release/command.js';

/**
 * The version of `@loomcli/loom`, read from its manifest at run time because the manifest sits
 * outside the compiled `src` root. `../package.json` names it from `src` and from `dist` alike.
 */
const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const { version: packageVersion } = z.object({ version: z.string() }).parse(JSON.parse(manifest));

export const loom = new Application('loom', {
  description: "Run the Loom repository's changelog, pull request, and release tooling.",
  plugins: [help(), version()],
  version: packageVersion,
})
  .command(changelog)
  .command(pr)
  .command(release);
