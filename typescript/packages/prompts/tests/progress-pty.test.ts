/*
 * Acceptance plan for the skipped, warned, and cleared ends of a progress line on a real terminal
 * (docs/libs/prompts.md#progress, ADR-0170), under Node and Bun. A fixture writes a lane line and
 * opens three lines on a pseudo-terminal 60 columns wide, under a theme whose dim token is faint and
 * whose warning token is yellow. It clears the middle line while the others run, then skips the top
 * line and warns the bottom one. A headless emulator replays the transcript up to each mark:
 *
 * - The cleared line is gone, the lane line and the rows above and below it are as they were, and
 *   no blank row is left between them.
 * - The skipped line reads its message under the info glyph, every cell of it dim.
 * - The warned line reads its message under the warning glyph, the glyph alone in color and the
 *   message not dim.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';
import { replay } from '../../../scripts/test-screen.js';
import type { Screen } from '../../../scripts/test-screen.js';

const fixture = fileURLToPath(new URL('fixtures/progress-pty.mjs', import.meta.url));

/** The transcript up to the mark of that name. */
function cut(transcript: string, name: string): string {
  const at = transcript.indexOf(`\u001B]7777;${name}\u0007`);
  if (at === -1) {
    throw new Error(`The transcript holds no mark named "${name}".`);
  }
  return transcript.slice(0, at);
}

/** What the emulator shows once it has taken `text`, on a fresh screen 60 columns wide. */
function screen(text: string): Promise<Screen> {
  return replay([{ write: text }], { columns: 60 });
}

/** One elapsed time as the view writes it under a minute. */
const seconds = String.raw`\d+\.\ds`;

test.skipIf(zsh === undefined)(
  'on a real terminal a cleared line leaves no row, a skipped line is dim, and a warned line colors its glyph',
  async () => {
    const transcript = ptyTranscript(fixture, 60);
    const running = await screen(cut(transcript, 'running'));
    expect(running.lines).toHaveLength(4);
    expect(running.lines[0]).toBe('ℹ lane line');
    expect(running.lines[1]).toMatch(new RegExp(`^◐ Fetching records · ${seconds}$`, 'u'));
    expect(running.lines[2]).toMatch(new RegExp(`^◐ Reading the cache · ${seconds}$`, 'u'));
    expect(running.lines[3]).toMatch(
      new RegExp(`^◐ Fetching more ▰▰▰▰▰▰▰▰▰▱ 118/120 · ${seconds}$`, 'u'),
    );

    const cleared = await screen(cut(transcript, 'cleared'));
    expect(cleared.lines).toEqual([running.lines[0], running.lines[1], running.lines[3]]);

    const ended = await screen(cut(transcript, 'ended'));
    expect(ended.lines).toHaveLength(3);
    expect(ended.lines[0]).toBe('ℹ lane line');
    expect(ended.lines[1]).toMatch(
      new RegExp(`^ℹ Fetched nothing: the cache is fresh · ${seconds}$`, 'u'),
    );
    expect(ended.dim[1]).toBe(ended.lines[1]);
    expect(ended.lines[2]).toMatch(new RegExp(`^⚠ Fetched 118 of 120 records · ${seconds}$`, 'u'));
    expect(ended.colored[2]).toBe('⚠');
    const message = '⚠ Fetched 118 of 120 records ';
    expect(ended.dim[2]).toMatch(new RegExp(`^ {${String(message.length)}}· ${seconds}$`, 'u'));
  },
);
