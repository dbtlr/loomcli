import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { Application, Command } from '@loomcli/core';
import { manpage, refreshManpages } from '@loomcli/plugins/manpage';
import type { RefreshContext } from '@loomcli/plugins/manpage';
import { selfUpdate } from '@loomcli/plugins/self-update';

// The packed manpage plugin compiles against its declaration.
// `refreshManpages` is an `afterReplace` function for the packed self-update plugin.
// A run of `manpage generate` writes the pages into a folder under the working directory.
const refresh: (context: RefreshContext) => Promise<void> = refreshManpages;

const app = new Application('packed-man', {
  description: 'Write man pages from the packed plugin.',
  plugins: [manpage(), selfUpdate({ afterReplace: refresh })],
  version: '1.0.0',
}).command(new Command('greet', { description: 'Greet someone.' }).action(() => undefined));

const quiet = new Writable({ write: (_chunk, _encoding, done) => done() });
const folder = join(process.cwd(), 'packed-man');
process.exitCode = await app.run({
  host: {
    argv: ['manpage', 'generate', '--out', folder],
    platform: 'linux',
    release: { build: 'distributed' },
    stderr: quiet,
  },
});
const count = readdirSync(folder).length;
const title = readFileSync(join(folder, 'packed-man-greet.1'), 'utf8').split('\n')[0];
process.stdout.write(`${count} pages\n${title}\n`);
