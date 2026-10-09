import { readFileSync } from 'node:fs';

import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

import { buildCommand } from './commands/build/command.js';
import { changelog } from './commands/changelog/command.js';
import { checkCommand } from './commands/check/command.js';
import { pr } from './commands/pr/command.js';
import { release } from './commands/release/command.js';

/**
 * The version of `@loomcli/loom`, read from its manifest at run time because the manifest sits
 * outside the compiled `src` root. `../package.json` names it from `src` and from `dist` alike.
 */
const manifest = readFileSync(new URL('../package.json', import.meta.url), 'utf8');
const { version: packageVersion } = z.object({ version: z.string() }).parse(JSON.parse(manifest));

export const loom = new Application('loom', {
  description: 'The Loom toolchain. It acts on the package in the working directory.',
  plugins: [help(), version()],
  version: packageVersion,
})
  .command(buildCommand)
  .command(changelog)
  .command(checkCommand)
  .command(pr)
  .command(release);
