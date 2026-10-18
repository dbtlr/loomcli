import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { childEnvironment } from './test-process.js';
import { findOnPath } from './test-shell.js';

const driver = fileURLToPath(new URL('zpty-driver.zsh', import.meta.url));

/** The runtime a fixture runs on: `LOOM_TEST_RUNTIME`, Node by default. */
function runtime(): string {
  const name = process.env.LOOM_TEST_RUNTIME ?? 'node';
  return name === 'node' && !process.versions.bun ? process.execPath : name;
}

/** The zsh that drives the pseudo-terminal, or undefined where none is installed. */
const zsh = findOnPath('zsh');
if (zsh === undefined && process.env.LOOM_REQUIRE_SHELLS) {
  throw new Error(
    'LOOM_REQUIRE_SHELLS is set, but zsh, which drives the pseudo-terminal, is not installed.',
  );
}

/**
 * What a fixture prints on a real pseudo-terminal that starts `columns` wide, as one terminal
 * transcript up to its `@@DONE@@` line: the pty's CRLF line endings read as LF. The fixture
 * resizes the terminal itself with `stty`.
 */
function ptyTranscript(fixture: string, columns: number): string {
  const command = [
    'env',
    '-u',
    'COLUMNS',
    '-u',
    'LINES',
    'TERM=xterm-256color',
    'sh',
    '-c',
    `stty cols ${columns} rows 30 && exec "$0" "$1"`,
    runtime(),
    fixture,
  ];
  const result = spawnSync(zsh ?? 'zsh', [driver, ...command], {
    encoding: 'utf8',
    env: childEnvironment({}),
    input: 'expect @@DONE@@\nquit\n',
    timeout: 30_000,
  });
  const match = /@@BEGIN@@\n(?<output>[\s\S]*?)@@END@@/u.exec(result.stdout);
  if (match?.groups?.output === undefined) {
    throw new Error(`The driver printed no transcript:\n${result.stdout}${result.stderr}`);
  }
  return match.groups.output.replaceAll('\r\n', '\n');
}

export { ptyTranscript, zsh };
