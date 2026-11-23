/*
 * Acceptance plan for task groups on a real terminal (docs/libs/prompts.md#task-groups, ADR-0173),
 * under Node and Bun. A fixture writes a lane line and opens a tree on a pseudo-terminal 60 columns
 * wide, and a headless emulator replays the transcript up to each mark:
 *
 * - While the tree runs, its tasks draw indented under it in the order they opened, a finished
 *   task as its end line and a running task with its log row two columns further in.
 * - Once the tree succeeds, its tasks are gone and no blank row is left: the root's end line sits
 *   directly under the lane line.
 * - Once a second tree fails with a task open, its tasks stay under it in scrollback, the failed
 *   task's kept line directly above its end line, and no row shows twice.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { ptyTranscript, zsh } from '../../../scripts/test-pty.js';
import { replay } from '../../../scripts/test-screen.js';
import type { Screen } from '../../../scripts/test-screen.js';

const fixture = fileURLToPath(new URL('fixtures/progress-tasks-pty.mjs', import.meta.url));

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

/** The rows that appear more than once among `lines`, blank rows aside. */
function repeated(lines: readonly string[]): string[] {
  const seen = new Map<string, number>();
  for (const line of lines.filter((row) => row !== '')) {
    seen.set(line, (seen.get(line) ?? 0) + 1);
  }
  return [...seen].filter(([, count]) => count > 1).map(([line]) => line);
}

test.skipIf(zsh === undefined)(
  'on a real terminal a tree draws indented, collapses with no blank row when it succeeds, and stays under its root when it fails',
  async () => {
    const transcript = ptyTranscript(fixture, 60);

    const running = await screen(cut(transcript, 'running'));
    expect(running.lines).toHaveLength(5);
    expect(running.lines[0]).toBe('ℹ lane line');
    expect(running.lines[1]).toMatch(timed('◐ Deploying'));
    expect(running.lines[2]).toMatch(timed(' {2}✔ Built the image'));
    expect(running.lines[3]).toMatch(timed(' {2}◐ Pushing the image'));
    expect(running.lines[4]).toBe('    Pushed layer 1');

    const collapsed = await screen(cut(transcript, 'collapsed'));
    expect(collapsed.lines).toHaveLength(2);
    expect(collapsed.lines[0]).toBe('ℹ lane line');
    expect(collapsed.lines[1]).toMatch(timed('✔ Deployed'));

    const failed = await screen(cut(transcript, 'failed'));
    expect(repeated(failed.lines)).toEqual([]);
    expect(failed.lines).toHaveLength(6);
    expect(failed.lines.slice(0, 2)).toEqual(collapsed.lines);
    expect(failed.lines[2]).toMatch(timed('✘ Releasing'));
    expect(failed.lines[3]).toMatch(timed(' {2}✔ Tagged'));
    expect(failed.lines[4]).toBe('    npm error code E403');
    expect(failed.lines[5]).toMatch(timed(' {2}✘ Publishing'));
  },
);
