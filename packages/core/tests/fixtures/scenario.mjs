import { readFileSync } from 'node:fs';

import { DeclarationError } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';

/** Records a scenario's own writes alongside those of its isolated application runs. */
export function scenario(options = {}) {
  const env = options.env ?? {};
  const primary = mockProcess({ env });
  const mocks = [primary];
  let stdout = '';
  let exitCode = undefined;
  let stderr = '';
  const positions = new Map();
  function flush() {
    for (const mock of mocks) {
      const position = positions.get(mock) ?? 0;
      for (const write of mock.transcript.slice(position)) {
        if (write.stream === 'stdout') {
          stdout += write.text;
        } else {
          stderr += write.text;
        }
      }
      positions.set(mock, mock.transcript.length);
    }
  }
  return {
    createProcess: (fields = {}) => {
      const { terminal, stdin, stdout: output, stderr: diagnostic, ...facts } = fields;
      const streams =
        terminal === undefined ? [] : ['stdout', 'stderr'].filter((name) => terminal[name]?.isTTY);
      const keyboard = terminal?.stdin?.isTTY;
      const mock = mockProcess({
        cwd: options.cwd ?? process.cwd(),
        ...(env.FIXTURE_TTY === '1'
          ? { terminal: { columns: 80, rows: 24, streams: ['stdout'] } }
          : {}),
        argv: options.argv ?? [],
        env,
        readSource: (path) => {
          try {
            return readFileSync(path, 'utf8');
          } catch {
            return undefined;
          }
        },
        ...(options.input === undefined ? {} : { stdin: options.input }),
        ...facts,
        ...(terminal === undefined || (!keyboard && streams.length === 0)
          ? {}
          : {
              terminal: {
                columns: terminal.stdout?.columns ?? terminal.stderr?.columns ?? 80,
                rows: 24,
                streams,
                ...(keyboard ? { keys: [] } : {}),
              },
            }),
      });
      // A few scenarios supply a failing destination or an unreadable stream deliberately.
      // All other facts and effects still belong to this mock's sealed handle.
      if (stdin !== undefined) {
        mock.stdin = stdin;
      }
      if (output !== undefined) {
        mock.stdout = output;
      }
      if (diagnostic !== undefined) {
        mock.stderr = diagnostic;
      }
      if (terminal !== undefined) {
        mock.terminal = terminal;
      }
      mocks.push(mock);
      return mock;
    },
    diagnostic: primary.stderr,
    env,
    set exitCode(code) {
      exitCode = code;
    },
    output: primary.stdout,
    result: () => {
      flush();
      return { status: exitCode ?? mocks.at(-1)?.exitCode ?? 0, stderr, stdout };
    },
    stderr: (text) => {
      flush();
      stderr += text;
    },
    stdout: (text) => {
      flush();
      stdout += text;
    },
    stopped: Symbol('scenario stopped'),
    thrown: (error) => {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      flush();
      stderr += `${error}\n`;
      exitCode = 1;
    },
  };
}
