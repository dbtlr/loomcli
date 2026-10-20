import { Readable, Writable } from 'node:stream';

import { Application } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { loomTheme } from '@loomcli/plugins/theme';

/**
 * One run of an application that installs the Loom theme and the background plugin, on a scripted
 * terminal that answers the background query as light. The host states all three streams as
 * terminals, because core queries only then; stdout is wide, so help never wraps. The arguments are
 * the command line, and the action prints the highlight token and the settled background.
 */
const argv = process.argv.slice(2);
const plugins = [help(), manifest(), loomTheme(), background()];

const app = new Application('notes', { description: 'Keep notes.', plugins, version: '1.0.0' })
  .globalOption('tag', { description: 'Tag the note.', type: 'string' })
  .action(({ host, out, style }) =>
    out.print(`${style.highlight('Saved')} ${host.terminal.background ?? 'undefined'}`),
  );

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
  host: {
    argv,
    env: { COLORTERM: 'truecolor', TERM: 'xterm-256color' },
    release: { build: 'distributed' },
    stderr,
    stdin,
    terminal: {
      stderr: { columns: 80, isTTY: true, rows: 24 },
      stdin: { isTTY: true },
      stdout: { columns: 200, isTTY: true, rows: 24 },
    },
  },
  rendering: { color: 'always' },
});
clearInterval(keepAlive);
process.stderr.write(`queried ${queried.count}\n`);
