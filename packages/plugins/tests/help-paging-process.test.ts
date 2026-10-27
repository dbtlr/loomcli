/*
 * Help paging where only a process can show it (docs/plugins/help.md#help-paging): a real terminal,
 * the real `/bin/sh`, and a fixture pager that, like less, stays open on `SIGINT`, under Node and Bun.
 *
 * - Ctrl-C. While the pager waits for a key, Ctrl-C at the terminal ends the pager by `SIGTERM`,
 *   which reaches it because the shell runs it behind `exec`, and the application dies by `SIGINT`
 *   with status 130. No pager process is left running.
 * - The shell. A `PAGER` that quotes a path holding a space runs that program, with `LESS=FRX`, and
 *   a `PAGER` that pipes through `tr a-z A-Z` hands the pager the page in capitals; the pager reads
 *   a key and quits, and the run exits 0.
 * - An early quit. A pager that exits at once without reading a page larger than a pipe's buffer
 *   leaves the run at 0 with no error on the terminal and the page unprinted.
 */
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { zsh } from '../../../scripts/test-pty.js';
import { drive } from '../../../scripts/test-terminal.js';

const fixture = fileURLToPath(new URL('fixtures/help-paging.mjs', import.meta.url));

/** The runtime a fixture runs on, by the name the shell finds it under. */
const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';

/** A folder whose name holds a space, for the pager and the page it records. */
const folder = join(mkdtempSync(join(tmpdir(), 'loom-help-paging-')), 'my pager');
mkdirSync(folder);
const pager = join(folder, 'pager.sh');
const recorded = join(folder, 'page.txt');

afterAll(() => {
  rmSync(join(folder, '..'), { force: true, recursive: true });
});

// A pager that records its page and stays open on SIGINT, as less does, until a key or SIGTERM.
writeFileSync(
  pager,
  [
    '#!/bin/sh',
    "trap '' INT",
    "trap 'echo pager-term; exit 0' TERM",
    `cat > '${recorded}'`,
    'echo "pager-ready:$$:$LESS:"',
    'read reply < /dev/tty',
    'echo pager-read',
    '',
  ].join('\n'),
);
chmodSync(pager, 0o755);

/** The fixture's help on a ten-row terminal, under `sh`, which then prints the status it ended with. */
function helpOnTerminal(env: Record<string, string>) {
  return drive(
    [
      'sh',
      '-c',
      // The shell catches Ctrl-C, so it outlives the fixture to print its status; a caught signal
      // Is back at its default in the fixture, which Ctrl-C still reaches.
      [
        'trap : INT',
        'stty rows 10 cols 80',
        '"$0" "$1" --help',
        'echo "status=$?"',
        'echo @@DONE@@',
      ].join('; '),
      runtime,
      fixture,
    ],
    { LOOM_FIXTURE_SCENARIO: 'notes', ...env },
  );
}

/** The process id the fixture pager announced. */
function pagerPid(transcript: string): number {
  const pid = /pager-ready:(?<pid>\d+):/u.exec(transcript)?.groups?.pid;
  if (pid === undefined) {
    throw new Error(`The pager announced no process id:\n${transcript}`);
  }
  return Number(pid);
}

/** Whether a process is still running. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

test.skipIf(zsh === undefined)(
  'Ctrl-C while the pager waits ends the pager and the application dies by SIGINT',
  async () => {
    const terminal = helpOnTerminal({ PAGER: `'${pager}'` });
    try {
      const ready = await terminal.expect('pager-ready:*:FRX:');
      expect(readFileSync(recorded, 'utf8')).toContain('Run add on the notes.');
      terminal.send(String.raw`\x03`);
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('pager-term');
      expect(ended).toContain('status=130');
      expect(running(pagerPid(ready))).toBe(false);
    } finally {
      await terminal.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'a PAGER that pipes through tr hands the pager the page in capitals, and a key quits it with 0',
  async () => {
    const terminal = helpOnTerminal({ PAGER: `tr a-z A-Z | '${pager}'` });
    try {
      await terminal.expect('pager-ready:*:FRX:');
      expect(readFileSync(recorded, 'utf8')).toContain('RUN ADD ON THE NOTES.');
      terminal.send(String.raw`\r`);
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('pager-read');
      expect(ended).toContain('status=0');
    } finally {
      await terminal.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'a pager that quits before reading a page larger than a pipe leaves the run at 0',
  async () => {
    const terminal = drive(
      [
        'sh',
        '-c',
        ['stty rows 10 cols 80', '"$0" "$1" --help', 'echo "status=$?"', 'echo @@DONE@@'].join(
          '; ',
        ),
        runtime,
        fixture,
      ],
      { LOOM_FIXTURE_SCENARIO: 'large', PAGER: 'true' },
    );
    try {
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('status=0');
      expect(ended).not.toContain('Keep notes in a folder.');
      expect(ended).not.toMatch(/error|EPIPE/iu);
    } finally {
      await terminal.close();
    }
  },
);
