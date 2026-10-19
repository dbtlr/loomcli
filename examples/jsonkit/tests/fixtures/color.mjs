import { jsonkit } from '../../dist/application.js';

/**
 * Jsonkit run on a terminal that supports color, or with every stream piped. argv[2] is `tty` or
 * `pipe`, and the rest of argv is the command line.
 */
const [terminal, ...argv] = process.argv.slice(2);

const stream = terminal === 'tty' ? { columns: 100, isTTY: true, rows: 24 } : { isTTY: false };

await jsonkit.run({
  host: {
    argv,
    terminal: { stderr: stream, stdin: { isTTY: false }, stdout: stream },
  },
});
