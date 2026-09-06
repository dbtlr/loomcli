import type { Writable } from 'node:stream';

import type { Host, RunOptions } from './types.js';

// Process stream declarations assume a terminal, but pipes omit isTTY at runtime.
function isTerminal(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

export function captureHost(overrides: RunOptions['host'], stderr: Writable): Host {
  const { argv, cwd, env, stdin, stdout, terminal } = overrides ?? {};
  return {
    argv: [...(argv ?? process.argv.slice(2))],
    cwd: cwd ?? process.cwd(),
    env: { ...(env ?? process.env) },
    stderr,
    stdin: stdin ?? process.stdin,
    stdout: stdout ?? process.stdout,
    terminal: terminal
      ? {
          stderr: { ...terminal.stderr },
          stdin: { ...terminal.stdin },
          stdout: { ...terminal.stdout },
        }
      : {
          stderr: {
            columns: process.stderr.columns,
            isTTY: isTerminal(process.stderr),
            rows: process.stderr.rows,
          },
          stdin: { isTTY: isTerminal(process.stdin) },
          stdout: {
            columns: process.stdout.columns,
            isTTY: isTerminal(process.stdout),
            rows: process.stdout.rows,
          },
        },
  };
}
