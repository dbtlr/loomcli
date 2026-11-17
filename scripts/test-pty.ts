import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { childEnvironment } from './test-process.js';
import { requiredProgram } from './test-shell.js';

const driver = fileURLToPath(new URL('zpty-driver.zsh', import.meta.url));

/** The runtime a fixture runs on: `LOOM_TEST_RUNTIME`, Node by default. */
function runtime(): string {
  const name = process.env.LOOM_TEST_RUNTIME ?? 'node';
  return name === 'node' && !process.versions.bun ? process.execPath : name;
}

/** The zsh that drives the pseudo-terminal, or undefined where none is installed. */
const zsh = requiredProgram('zsh');

/** One step of an operator at the terminal: wait until the output shows `expect`, then type `send`. */
interface PtyStep {
  readonly expect: string;
  readonly send: string;
}

/**
 * What a fixture prints on a real pseudo-terminal that starts `columns` wide and `rows` high, 30
 * rows unless a test names another height, as one terminal transcript up to its `@@DONE@@` line:
 * the pty's CRLF line endings read as LF. The fixture resizes the terminal itself with `stty`. Each of `steps` waits for its text, which the driver
 * reads as a glob, and then types its keys, as an operator answering a question does, and the
 * transcript holds what the terminal echoed of them, as a terminal in its line mode echoes.
 */
function ptyTranscript(
  fixture: string,
  columns: number,
  steps: readonly PtyStep[] = [],
  rows = 30,
): string {
  const command = [
    'env',
    '-u',
    'COLUMNS',
    '-u',
    'LINES',
    'TERM=xterm-256color',
    'sh',
    '-c',
    // A terminal echoes what the operator types, which the driver's pty leaves off.
    `stty cols ${columns} rows ${rows} echo && exec "$0" "$1"`,
    runtime(),
    fixture,
  ];
  const result = spawnSync(zsh ?? 'zsh', [driver, ...command], {
    encoding: 'utf8',
    env: childEnvironment({}),
    input: `${steps.map((step) => `expect ${step.expect}\nsend ${step.send}\n`).join('')}expect @@DONE@@\nquit\n`,
    timeout: 30_000,
  });
  // Each expect prints the output through its match, so the blocks in order are the transcript.
  const blocks = [...result.stdout.matchAll(/@@BEGIN@@\n(?<output>[\s\S]*?)@@END@@/gu)];
  if (blocks.length !== steps.length + 1) {
    throw new Error(`The driver printed no transcript:\n${result.stdout}${result.stderr}`);
  }
  return blocks
    .map((block) => block.groups?.output ?? '')
    .join('')
    .replaceAll('\r\n', '\n');
}

export { ptyTranscript, zsh };
export type { PtyStep };
