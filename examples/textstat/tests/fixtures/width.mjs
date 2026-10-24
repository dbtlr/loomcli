import { processHandle } from '@loomcli/core';

import { textstat } from '../../dist/application.js';

/**
 * Textstat run on a terminal whose stdout reports a fixed width, with no `COLUMNS` in its
 * environment. The width is argv[2], and the rest of argv is the command line.
 */
const [width, ...argv] = process.argv.slice(2);

await textstat.run({
  process: processHandle({
    argv,
    env: {},
    terminal: {
      stderr: { columns: undefined, isTTY: false, rows: undefined },
      stdin: { isTTY: false },
      stdout: { columns: Number(width), isTTY: true, rows: 24 },
    },
  }),
  rendering: { color: 'never', hyperlinks: 'never', modifiers: 'never' },
});
