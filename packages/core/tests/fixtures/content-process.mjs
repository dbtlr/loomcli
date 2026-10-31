import { execFileSync } from 'node:child_process';
import { closeSync } from 'node:fs';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';

import { processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';
import { fileApplication, scalarApplication } from './content.mjs';

const [scenario, ...argv] = process.argv.slice(2);
const [path] = argv;

if (scenario === 'named-pipe') {
  process.stdout.write(
    execFileSync(
      'sh',
      [
        '-c',
        String.raw`printf "transport sentinel\n" | "$@"`,
        'content-input',
        process.execPath,
        fileURLToPath(import.meta.url),
        'named-file-unread',
        path,
      ],
      { encoding: 'utf8', timeout: 5000 },
    ),
  );
}

if (['named-redirected', 'named-fifo', 'argv-pipe', 'argv-substitution'].includes(scenario)) {
  const scripts = {
    'argv-pipe': String.raw`printf "transport sentinel\n" | "$@"`,
    'argv-substitution': String.raw`"$@" <(printf "source sentinel\n")`,
    'named-fifo': String.raw`mkfifo "$1"; fifo=$1; shift; printf "source sentinel\n" > "$fifo" & exec "$@"`,
    'named-redirected': 'source=$1; shift; exec "$@" < "$source"',
  };
  const named = scenario.startsWith('named-');
  process.stdout.write(
    execFileSync(
      scenario === 'argv-substitution' ? 'bash' : 'sh',
      [
        '-c',
        scripts[scenario],
        'content-input',
        ...(named ? [path] : []),
        process.execPath,
        fileURLToPath(import.meta.url),
        named ? 'named-file-unread' : 'scalar',
        ...(named ? [path] : ['--file', ...(path === undefined ? [] : [path])]),
      ],
      { encoding: 'utf8', timeout: 5000 },
    ),
  );
}

if (['named-file-unread', 'file-closed-stdin'].includes(scenario)) {
  if (scenario === 'file-closed-stdin') {
    closeSync(0);
  }
  const app = fileApplication();
  const outcome = await app.invoke([], { args: { file: path } });
  process.stdout.write(
    JSON.stringify(
      scenario === 'named-file-unread'
        ? { outcome, remaining: await text(process.stdin) }
        : outcome,
    ),
  );
}

if (scenario === 'scalar') {
  await scalarApplication().run({ process: processHandle({ argv, home: fixtureHome() }) });
}
