/*
 * A streamed message where only a real terminal shows it (docs/core/output.md#a-streamed-message,
 * ADR-0163), under Node and Bun. A fixture opens a live region, streams an answer through `info`
 * above it on a pseudo-terminal 40 columns wide, then writes the same answer whole in a second run.
 * A headless emulator replays the transcript up to each mark the fixture wrote after a chunk:
 *
 * - The unfinished row grows as each chunk arrives, and a word that outgrows it moves to the next row.
 * - It sits above the open live region at every chunk.
 * - The final screen equals the screen of the joined text.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';
import { replay } from '../../../scripts/test-screen.js';

const fixture = fileURLToPath(new URL('fixtures/streamed-pty.mjs', import.meta.url));

/** The transcript up to the mark of that name, or after it when `after` is set. */
function cut(transcript: string, name: string, after = false): string {
  const marker = `\u001B]7777;${name}\u0007`;
  const at = transcript.indexOf(marker);
  if (at === -1) {
    throw new Error(`The transcript holds no mark named "${name}".`);
  }
  return after ? transcript.slice(at + marker.length) : transcript.slice(0, at);
}

/** What the emulator shows once it has taken `text`, on a fresh screen 40 columns wide. */
async function screen(text: string): Promise<readonly string[]> {
  const shown = await replay([{ write: text }], { columns: 40 });
  return shown.lines;
}

test.skipIf(zsh === undefined)(
  'on a real terminal a streamed message grows its unfinished row above a live region and ends as the joined text',
  async () => {
    const transcript = ptyTranscript(fixture, 40).replace(/@@DONE@@\n?$/u, '');
    await expect(screen(cut(transcript, 'chunk-0'))).resolves.toEqual([
      'ℹ Loom is a toolkit for',
      'Working',
    ]);
    await expect(screen(cut(transcript, 'chunk-1'))).resolves.toEqual([
      'ℹ Loom is a toolkit for command-line',
      '  applications.',
      'Working',
    ]);
    await expect(screen(cut(transcript, 'chunk-2'))).resolves.toEqual([
      'ℹ Loom is a toolkit for command-line',
      '  applications. It parses, rou',
      'Working',
    ]);
    await expect(screen(cut(transcript, 'chunk-3'))).resolves.toEqual([
      'ℹ Loom is a toolkit for command-line',
      '  applications. It parses, routes, and',
      '  renders.',
      'Working',
    ]);
    const streamed = await screen(cut(transcript, 'joined'));
    expect(streamed).toEqual(await screen(cut(transcript, 'joined', true)));
    expect(streamed).toEqual([
      'ℹ Loom is a toolkit for command-line',
      '  applications. It parses, routes, and',
      '  renders.',
      'Working',
    ]);
  },
);
