import { Readable, Writable } from 'node:stream';

import { processHandle } from '@loomcli/core';

import { backgroundApplication } from './background-app.ts';

/**
 * One run of the background fixture application on a scripted terminal that answers the background
 * query as light. The host states all three streams as terminals, because core queries only then;
 * stdout is wide, so help never wraps. The arguments are the command line.
 */
const argv = process.argv.slice(2);
const app = backgroundApplication();

const queried = { count: 0 };

/** A terminal stdin the scripted terminal answers on. */
const stdin = Object.assign(new Readable({ read: () => undefined }), {
  isRaw: false,
  isTTY: true,
  setRawMode(mode) {
    this.isRaw = mode;
    return this;
  },
});

/** A terminal stderr that answers the background query as a light terminal would. */
const stderr = new Writable({
  write(chunk, _encoding, callback) {
    const text = String(chunk);
    if (text.includes(`${String.fromCodePoint(27)}[c`)) {
      queried.count += 1;
      const escape = String.fromCodePoint(27);
      setTimeout(() => stdin.push(`${escape}]11;rgb:ffff/ffff/ffff${escape}\\${escape}[?62c`), 5);
    } else {
      process.stderr.write(chunk);
    }
    callback();
  },
});

const keepAlive = setInterval(() => undefined, 60_000);
await app.run({
  process: processHandle({
    argv,
    env: { COLORTERM: 'truecolor', TERM: 'xterm-256color' },
    stderr,
    stdin,
    terminal: {
      stderr: { columns: 80, isTTY: true, rows: 24 },
      stdin: { isTTY: true },
      stdout: { columns: 200, isTTY: true, rows: 24 },
    },
  }),
  rendering: { color: 'always' },
});
clearInterval(keepAlive);
process.stderr.write(`queried ${queried.count}\n`);
