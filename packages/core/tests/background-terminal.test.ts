// Acceptance plan: see packages/core/tests/background.test.ts.

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, expect, test } from 'vite-plus/test';

import { zsh } from '../../../scripts/test-pty.js';

const driver = fileURLToPath(new URL('../../../scripts/zpty-driver.zsh', import.meta.url));
const fixture = fileURLToPath(new URL('fixtures/background-terminal.mjs', import.meta.url));

/** A fresh home for the interactive shell, so nothing reads or writes the developer's own. */
const home = mkdtempSync(join(tmpdir(), 'loom-background-terminal-'));
const xdg = join(home, 'xdg');
mkdirSync(xdg);

afterAll(() => {
  rmSync(home, { force: true, recursive: true });
});

/** The runtime's own executable, which the shell runs by its absolute path. */
function runtime(): string {
  const name = process.env.LOOM_TEST_RUNTIME ?? 'node';
  if (name === 'node' && !process.versions.bun) {
    return process.execPath;
  }
  return spawnSync(name, ['-e', 'process.stdout.write(process.execPath)'], { encoding: 'utf8' })
    .stdout;
}

/**
 * What an interactive zsh with job control prints on a real pseudo-terminal for the driver steps
 * given, with the fixture's command in place of `<fixture>`. The shell starts with no startup files
 * under a temporary home.
 */
function session(steps: readonly string[]): string {
  const command = `${runtime()} ${fixture}`;
  const result = spawnSync(zsh ?? 'zsh', [driver, 'zsh', '-f', '-i'], {
    encoding: 'utf8',
    env: {
      HOME: home,
      PATH: '/usr/bin:/bin',
      TERM: 'xterm-256color',
      XDG_CACHE_HOME: xdg,
      XDG_CONFIG_HOME: xdg,
      XDG_DATA_HOME: xdg,
      XDG_STATE_HOME: xdg,
      ZDOTDIR: home,
    },
    input: `${steps.map((step) => step.replace('<fixture>', command)).join('\n')}\nquit\n`,
    timeout: 30_000,
  });
  // The driver frames each expectation's output, so the frames are joined back into one transcript.
  return result.stdout.replaceAll('@@END@@\n@@BEGIN@@\n', '').replaceAll('\r', '');
}

/** A step that prints the last status, and the expectation that waits until the shell printed it. */
const status = [String.raw`send echo status=$? done-$((40+2))\n`, 'expect done-42'];

test.skipIf(zsh === undefined)(
  'a foreground run reads the terminal answer and pushes typeahead back to stdin',
  () => {
    const transcript = session([
      'expect %',
      String.raw`send <fixture>\n`,
      'expect 996n',
      String.raw`send q\0033]11;rgb:ffff/ffff/ffff\0007\0033[?62c`,
      String.raw`expect typeahead=\[q\]`,
      ...status,
    ]);
    expect(transcript).toContain('background=light typeahead=[q]');
    expect(transcript).toContain('status=0 done-42');
  },
);

test.skipIf(zsh === undefined)(
  'a run whose action never reads stdin exits once the terminal answers, with no key pressed',
  () => {
    const transcript = session([
      'expect %',
      String.raw`send SHADE_STDIN=untouched <fixture>\n`,
      'expect 996n',
      String.raw`send \0033]11;rgb:ffff/ffff/ffff\0007\0033[?62c`,
      'expect background=light',
      // The shell's next prompt arrives before any key is sent, so the run ended on its own.
      'expect %',
      ...status,
    ]);
    expect(transcript).not.toContain('@@TIMEOUT@@');
    expect(transcript).toContain('status=0 done-42');
  },
);

test.skipIf(zsh === undefined)('Ctrl-C during the wait ends the run with status 130', () => {
  const transcript = session([
    'expect %',
    String.raw`send <fixture>\n`,
    'expect 996n',
    String.raw`send \0003\0033]11;rgb:ffff/ffff/ffff\0007\0033[?62c`,
    // The shell's next prompt, so the status line is typed at the shell rather than into the run.
    'expect %',
    ...status,
  ]);
  expect(transcript).toContain('status=130 done-42');
  expect(transcript).not.toContain('background=');
});

test.skipIf(zsh === undefined)(
  'a run in a backgrounded job neither stops nor hangs, and writes no query',
  () => {
    const transcript = session([
      'expect %',
      String.raw`send <fixture> &\n`,
      String.raw`send wait\n`,
      ...status,
    ]);
    expect(transcript).toContain('background=undefined typeahead=[]');
    expect(transcript).toContain('status=0 done-42');
    expect(transcript).not.toContain('suspended');
    expect(transcript).not.toContain('996n');
  },
);
