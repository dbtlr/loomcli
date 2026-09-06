import type { Writable } from 'node:stream';

import type { Host, RunOptions } from './types.js';

// Process stream declarations assume a terminal, but pipes omit isTTY at runtime.
function isTerminal(stream: { isTTY?: boolean }): boolean {
  return stream.isTTY === true;
}

function dimension(value: number | undefined): number | undefined {
  return value === 0 ? undefined : value;
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
            columns: dimension(process.stderr.columns),
            isTTY: isTerminal(process.stderr),
            rows: dimension(process.stderr.rows),
          },
          stdin: { isTTY: isTerminal(process.stdin) },
          stdout: {
            columns: dimension(process.stdout.columns),
            isTTY: isTerminal(process.stdout),
            rows: dimension(process.stdout.rows),
          },
        },
  };
}
