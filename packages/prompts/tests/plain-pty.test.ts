/*
 * Acceptance plan for the plain switch on a real terminal (docs/core/output.md#the-plain-switch,
 * docs/libs/prompts.md#asking-line-by-line, ADR-0169), under Node and Bun. A fixture runs with
 * `--plain` on a pseudo-terminal through a progress line that updates and spins, a streamed
 * message whose chunks split a word and a line, and each kind of question, which the driver
 * answers once its asking row has printed:
 *
 * - The raw transcript holds no cursor movement and no erasure: no CSI sequence that moves the
 *   cursor or erases, no saved or restored cursor, no sequence that hides or shows the cursor or
 *   turns bracketed paste on, and no carriage return that is not part of a line break.
 * - The progress line prints its start and end lines alone, the streamed message its lines, and
 *   each question its pieces once, with the terminal's echo of each answer but the secret's.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';

const fixture = fileURLToPath(new URL('fixtures/plain-pty.mjs', import.meta.url));

/**
 * A sequence that moves the cursor or erases: a CSI sequence that ends in a cursor-movement,
 * erase, scroll, or save and restore final byte, a cursor visibility or bracketed paste switch,
 * ESC 7 or ESC 8, or a bare carriage return.
 */
const escape = String.fromCodePoint(27);
const redraw = new RegExp(
  `${escape}\\[[0-9;?]*[ABCDEFGHJKSTfsu]|${escape}\\[\\?(?:25|2004)[hl]|${escape}[78]|\\r(?!\\n)`,
  'u',
);

/** The operator's answers, each typed once its asking row has printed; `?` matches a bracket. */
const steps = [
  { expect: 'my-app?: ', send: String.raw`\r` },
  { expect: 'Token: ', send: String.raw`hunter2\r` },
  { expect: 'y/N?: ', send: String.raw`y\r` },
  { expect: 'number ?1?: ', send: String.raw`2\r` },
  { expect: 'commas: ', send: String.raw`1,2\r` },
  { expect: 'Search: ', send: String.raw`al\r` },
  { expect: 'search again: ', send: String.raw`1\r` },
  { expect: 'open your editor', send: String.raw`\r` },
];

test.skipIf(zsh === undefined)(
  'with --plain on a real terminal, progress, a streamed message, and every question never move the cursor or erase',
  () => {
    const transcript = ptyTranscript(fixture, 60, steps).replace(/@@DONE@@\n?$/u, '');
    expect(transcript).not.toMatch(redraw);
    expect(transcript).toBe(
      [
        'ℹ Fetching records',
        '✔ Fetched 4 records',
        'ℹ Loom is a toolkit for command-line applications.',
        '  It parses, routes, and renders.',
        'Project name [my-app]: ',
        'Token: ',
        'Deploy now? [y/N]: y',
        'Storage backend',
        '  1. sqlite',
        '  neon (needs an account)',
        '  2. postgres',
        'Enter a number [1]: 2',
        'Features',
        '  1. backups',
        '  2. telemetry',
        'Enter numbers separated by commas: 1,2',
        'Feature',
        'Search: al',
        '  1. alerts',
        'Enter a number, or text to search again: 1',
        '? Release notes › Press Enter to open your editor',
        '? Release notes › Waiting for your editor to close the file…',
        '? Release notes · Notes',
        'ℹ ["my-app","hunter2",true,"postgres",["backups","telemetry"],"alerts","Notes"]',
        '',
      ].join('\n'),
    );
  },
);
