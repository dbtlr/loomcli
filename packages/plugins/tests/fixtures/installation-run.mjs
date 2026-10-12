import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';

/**
 * Runs the installed-files module of the built pack in its own process, as a plugin's Command
 * would. The one argument is a JSON request:
 *
 * - `record` and `files`, each file `{ path, content }` or `{ path, fill, size }` for `size` copies
 *   of the character `fill`, installed by the plugin `skill`;
 * - `killAfterRename`: the path whose rename into place ends the process with SIGKILL;
 * - `killBeforeMkdir`: the directory whose creation ends the process with SIGKILL first;
 * - `rounds`: how many installs to run one after another, each failure caught and counted.
 *
 * The traps replace a `node:fs` function and resync the builtin's ESM exports, so they run under
 * Node alone. The fixture prints each outcome as one JSON line.
 */
const request = JSON.parse(process.argv[2]);

if (request.killAfterRename !== undefined) {
  const rename = fs.renameSync;
  fs.renameSync = (from, to) => {
    rename(from, to);
    if (to === request.killAfterRename) {
      process.kill(process.pid, 'SIGKILL');
    }
  };
  syncBuiltinESMExports();
}
if (request.killBeforeMkdir !== undefined) {
  const mkdir = fs.mkdirSync;
  fs.mkdirSync = (path, options) => {
    if (path === request.killBeforeMkdir) {
      process.kill(process.pid, 'SIGKILL');
    }
    return mkdir(path, options);
  };
  syncBuiltinESMExports();
}

const { install } = await import('../../dist/src/installation/files.js');

const files = request.files.map(({ content, fill, path, size }) => ({
  content: content ?? fill.repeat(size),
  path,
}));
const signal = new AbortController().signal;
for (let round = 0; round < (request.rounds ?? 1); round += 1) {
  try {
    const outcome = install({ files, plugin: 'skill', record: request.record, signal });
    process.stdout.write(`${JSON.stringify(outcome)}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ failed: error.code ?? error.message })}\n`);
  }
}
