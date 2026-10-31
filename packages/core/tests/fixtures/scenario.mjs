import { readFileSync } from 'node:fs';

import { DeclarationError } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';

/** Records a scenario's own writes alongside those of its isolated application runs. */
export function scenario(options = {}) {
  const env = options.env ?? {};
  const primary = mockProcess({ env });
  const mocks = [primary];
  /** Every mock a run was given, recorded or not, so the last run's exit code is the status. */
  const created = [primary];
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
      const { stdout: output, stderr: diagnostic, record = true, ...facts } = fields;
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
      });
      created.push(mock);
      if (record) {
        mocks.push(mock);
      }
      if (output === undefined && diagnostic === undefined) {
        return mock;
      }
      /*
       * A scenario that supplies its own destination (one that fails, discards, collects, or
       * applies back-pressure) writes there in place of the mock's recording stream; the exit
       * code still reaches the mock.
       */
      return {
        ...mock,
        get exitCode() {
          return mock.exitCode;
        },
        set exitCode(code) {
          mock.exitCode = code;
        },
        stderr: diagnostic ?? mock.stderr,
        stdout: output ?? mock.stdout,
      };
    },
    diagnostic: primary.stderr,
    env,
    set exitCode(code) {
      exitCode = code;
    },
    output: primary.stdout,
    result: () => {
      flush();
      return { status: exitCode ?? created.at(-1)?.exitCode ?? 0, stderr, stdout };
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
