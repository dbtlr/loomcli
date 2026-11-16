/*
 * Acceptance plan for a progress line's log on a real terminal (docs/libs/prompts.md#a-lines-log,
 * ADR-0172), under Node and Bun. A fixture writes a lane line and opens two lines on a
 * pseudo-terminal 60 columns wide, under a theme whose dim token is faint. The top line logs 7
 * lines and the bottom line one. The top line ends, then the bottom line fails. A headless emulator
 * replays the transcript up to each mark:
 *
 * - While both run, the top line shows its newest 5 log lines under it and the bottom line its
 *   one, each two columns in and dim.
 * - Once the top line ends, its rows are gone and no blank row is left: the success line sits
 *   directly above the running bottom line.
 * - Once the bottom line fails, its kept line stands directly above its failure line, still dim,
 *   and the failure line is not.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';
import { replay } from '../../../scripts/test-screen.js';
import type { Screen } from '../../../scripts/test-screen.js';

const fixture = fileURLToPath(new URL('fixtures/progress-log-pty.mjs', import.meta.url));

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

/** A row that matches `prefix` and then an elapsed time. */
function timed(prefix: string): RegExp {
  return new RegExp(`^${prefix} · ${seconds}$`, 'u');
}

test.skipIf(zsh === undefined)(
  'on a real terminal the log rows draw dim under their line, go with no blank row when it ends, and stay above it when it fails',
  async () => {
    const transcript = ptyTranscript(fixture, 60);
    const rows = ['npm http fetch 3', 'npm http fetch 4', 'npm http fetch 5'];
    const newest = [...rows, 'npm http fetch 6', 'npm http fetch 7'].map((row) => `  ${row}`);

    const running = await screen(cut(transcript, 'running'));
    expect(running.lines).toHaveLength(9);
    expect(running.lines[0]).toBe('ℹ lane line');
    expect(running.lines[1]).toMatch(timed('◐ Installing dependencies'));
    expect(running.lines.slice(2, 7)).toEqual(newest);
    expect(running.dim.slice(2, 7)).toEqual(newest);
    expect(running.lines[7]).toMatch(timed('◐ Building'));
    expect(running.lines[8]).toBe('  tsc error TS2304');
    expect(running.dim[8]).toBe('  tsc error TS2304');

    const ended = await screen(cut(transcript, 'ended'));
    expect(ended.lines).toHaveLength(4);
    expect(ended.lines[0]).toBe('ℹ lane line');
    expect(ended.lines[1]).toMatch(timed('✔ Installed dependencies'));
    expect(ended.lines[2]).toMatch(timed('◐ Building'));
    expect(ended.lines[3]).toBe('  tsc error TS2304');

    const failed = await screen(cut(transcript, 'failed'));
    expect(failed.lines).toHaveLength(4);
    expect(failed.lines.slice(0, 2)).toEqual(ended.lines.slice(0, 2));
    expect(failed.lines[2]).toBe('  tsc error TS2304');
    expect(failed.dim[2]).toBe('  tsc error TS2304');
    expect(failed.lines[3]).toMatch(timed('✘ Building'));
    expect(failed.dim[3]).toMatch(new RegExp(`^ {11}· ${seconds}$`, 'u'));
  },
);
