/*
 * Acceptance plan for the plain switch on a real terminal (docs/core/output.md#the-plain-switch,
 * ADR-0169), under Node and Bun. A fixture runs with `--plain` on a pseudo-terminal through a
 * progress line that updates and spins, and a streamed message whose chunks split a word and a line:
 *
 * - The raw transcript holds no cursor movement and no erasure: no CSI sequence that moves the
 *   cursor or erases, no saved or restored cursor, and no carriage return that is not part of a
 *   line break.
 * - The progress line prints its start and end lines alone, and the streamed message its lines.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';

const fixture = fileURLToPath(new URL('fixtures/plain-pty.mjs', import.meta.url));

/**
 * A sequence that moves the cursor or erases: a CSI sequence that ends in a cursor-movement,
 * erase, scroll, or save and restore final byte, ESC 7 or ESC 8, or a bare carriage return.
 */
const escape = String.fromCodePoint(27);
const redraw = new RegExp(`${escape}\\[[0-9;?]*[ABCDEFGHJKSTfsu]|${escape}[78]|\\r(?!\\n)`, 'u');

test.skipIf(zsh === undefined)(
  'with --plain on a real terminal, progress and a streamed message never move the cursor or erase',
  () => {
    const transcript = ptyTranscript(fixture, 60).replace(/@@DONE@@\n?$/u, '');
    expect(transcript).not.toMatch(redraw);
    expect(transcript).toBe(
      'ℹ Fetching records\n✔ Fetched 4 records\nℹ Loom is a toolkit for command-line applications.\n  It parses, routes, and renders.\n',
    );
  },
);
