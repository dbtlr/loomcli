import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';
import { findOnPath } from '../../../scripts/test-shell.js';

const driver = fileURLToPath(new URL('../../../scripts/zpty-driver.zsh', import.meta.url));
const fixture = fileURLToPath(new URL('fixtures/pty-columns.mjs', import.meta.url));

/** The runtime the fixture runs on: `LOOM_TEST_RUNTIME`, Node by default. */
function runtime(): string {
  const name = process.env.LOOM_TEST_RUNTIME ?? 'node';
  return name === 'node' && !process.versions.bun ? process.execPath : name;
}

const zsh = findOnPath('zsh');
if (zsh === undefined && process.env.LOOM_REQUIRE_SHELLS) {
  throw new Error(
    'LOOM_REQUIRE_SHELLS is set, but zsh, which drives the pseudo-terminal, is not installed.',
  );
}

/**
 * What the fixture prints on a real pseudo-terminal that starts 40 columns wide, as one terminal
 * transcript: the pty's CRLF line endings read as LF.
 */
function transcript(): string {
  const command = [
    'env',
    '-u',
    'COLUMNS',
    '-u',
    'LINES',
    'TERM=xterm-256color',
    'sh',
    '-c',
    'stty cols 40 rows 30 && exec "$0" "$1"',
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

test.skipIf(zsh === undefined)(
  'on a real terminal a lane wraps at 40 columns, and two renders read the width either side of a resize',
  () => {
    expect(transcript()).toBe(
      [
        '⚠ one two three four five six seven',
        '  eight nine ten eleven twelve',
        'first:100',
        'second:60',
        'host:60:60',
        '@@DONE@@',
      ].join('\n'),
    );
  },
);
