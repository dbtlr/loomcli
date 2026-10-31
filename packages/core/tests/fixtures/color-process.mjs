import { processHandle } from '@loomcli/core';

import { notesApplication } from './color.mjs';

// A bundle must read its baked release facts through the real process handle.
const [variant, terminal, ...argv] = process.argv.slice(2);
if (!['capture', 'capture-unmarked'].includes(variant)) {
  throw new Error(`Unknown variant: ${variant}`);
}
process.exitCode = await notesApplication(variant).run({
  process: processHandle({
    argv,
    terminal: {
      stderr: { columns: 80, isTTY: terminal === 'tty', rows: 24 },
      stdin: { isTTY: false },
      stdout: { columns: 80, isTTY: terminal === 'tty', rows: 24 },
    },
  }),
});
