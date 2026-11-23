import { Writable } from 'node:stream';

import { Application, processHandle } from '@loomcli/core';
import { verbose } from '@loomcli/plugins/verbose';

import { progress, progressStyle } from '../../dist/index.js';

/**
 * A progress line held open until the operator's SIGINT, on a recorded 60-column terminal. Every
 * write to stderr is recorded in order as an event a headless terminal emulator replays. The
 * fixture prints READY once the line is open, then { code, events } after the run resolves.
 */
const events = [];
const stderr = new Writable({
  write(chunk, _encoding, done) {
    events.push({ write: chunk.toString() });
    done();
  },
});
const app = new Application('progress', {
  description: 'Show progress lines.',
  plugins: [
    progressStyle({ spinner: { frames: ['◐', '◓', '◑', '◒'], interval: 60_000 } }),
    verbose(),
  ],
}).action(async (context) => {
  progress(context, { label: 'Waiting for SIGINT' });
  process.stdout.write('READY\n');
  // The fixture's own timer holds the process open until the signal; the line's timer never does.
  const hold = setInterval(() => undefined, 1000);
  await new Promise((resolve) => {
    context.signal.addEventListener(
      'abort',
      () => {
        clearInterval(hold);
        resolve();
      },
      { once: true },
    );
  });
});
const code = await app.run({
  process: processHandle({
    argv: [],
    env: { NO_COLOR: process.env.NO_COLOR, TERM: process.env.TERM },
    stderr,
    terminal: {
      stderr: { columns: 60, isTTY: true, rows: 24 },
      stdin: { isTTY: false },
      stdout: { columns: undefined, isTTY: false, rows: undefined },
    },
  }),
});
process.stdout.write(`${JSON.stringify({ code, events })}\n`);
