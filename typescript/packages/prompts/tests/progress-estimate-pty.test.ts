/*
 * Acceptance plan for a progress line's rate and time left on a real terminal
 * (docs/libs/prompts.md#rate-and-time-left, ADR-0171), under Node and Bun. A fixture opens a
 * counted line with `estimate` and the unit `files` on a pseudo-terminal 80 columns wide, under a
 * theme whose dim token is faint, and reports 1 at 500 and 40 at 12 000 milliseconds on a clock
 * it sets. A headless emulator replays the transcript up to each mark:
 *
 * - The running line reads its counts, its elapsed time, its rate, and its time left, and the
 *   elapsed time, the rate, the time left, and each `·` before them are dim.
 * - The success line replaces it without the rate or the time left.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';
import { replay } from '../../../scripts/test-screen.js';
import type { Screen } from '../../../scripts/test-screen.js';

const fixture = fileURLToPath(new URL('fixtures/progress-estimate-pty.mjs', import.meta.url));

/** The transcript up to the mark of that name. */
function cut(transcript: string, name: string): string {
  const at = transcript.indexOf(`\u001B]7777;${name}\u0007`);
  if (at === -1) {
    throw new Error(`The transcript holds no mark named "${name}".`);
  }
  return transcript.slice(0, at);
}

/** What the emulator shows once it has taken `text`, on a fresh screen 80 columns wide. */
function screen(text: string): Promise<Screen> {
  return replay([{ write: text }], { columns: 80 });
}

test.skipIf(zsh === undefined)(
  'on a real terminal a running line draws its rate and time left dim, and its end line draws neither',
  async () => {
    const transcript = ptyTranscript(fixture, 80);
    const running = await screen(cut(transcript, 'running'));
    expect(running.lines).toEqual([
      '◐ Copying files ▰▰▰▱▱▱▱▱▱▱ 40/120 · 12.0s · 3.3 files/s · about 24s left',
    ]);
    // The dim cells are the bar's incomplete cells and everything after the counts.
    const complete = '◐ Copying files ▰▰▰';
    const counts = ' 40/120 ';
    expect(running.dim[0]).toBe(
      `${' '.repeat(complete.length)}▱▱▱▱▱▱▱${' '.repeat(counts.length)}· 12.0s · 3.3 files/s · about 24s left`,
    );

    const ended = await screen(cut(transcript, 'ended'));
    expect(ended.lines).toEqual(['✔ Copied 120 files · 14.0s']);
  },
);
