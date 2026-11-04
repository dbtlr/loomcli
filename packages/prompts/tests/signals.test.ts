/*
 * Acceptance plan for a question's keys and signals (docs/libs/prompts.md#leaving-a-question and
 * docs/core/signals.md#raw-mode-readers), on a real terminal under Node and Bun:
 *
 * - Ctrl-C at a question ends the process by SIGINT, so a loop an interactive shell runs stops at
 *   the first round, and the shell reports 130. Keys typed after it in the same read are dropped,
 *   as a cooked terminal flushes its input on an interrupt.
 * - Ctrl-\ at a question ends the process by SIGQUIT, with the terminal cooked and the cursor shown.
 * - Ctrl-Z at a question suspends the process under a job-control shell: the question's frame is
 *   erased and the cursor shown before it stops, and `fg` redraws the question, which then takes an
 *   answer and leaves the terminal cooked. Part of a key held from an earlier read, such as the start
 *   of an arrow key's sequence, is dropped with the keys still unread, so it never joins a key typed
 *   after `fg`.
 * - A process that ends mid-question, by `kill -TERM` or by `process.exit()`, leaves the terminal
 *   cooked with the cursor shown.
 * - A process that ends by `process.exit()` while an editor question's editor runs ends the editor
 *   and removes its folder, and the question writes no terminal control over the editor.
 */
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { expect, test, vi } from 'vite-plus/test';

import { zsh } from '../../../scripts/test-pty.js';
import { drive } from '../../../scripts/test-terminal.js';

const fixture = new URL('fixtures/terminal.mjs', import.meta.url).pathname;

/** The runtime the fixture runs on, by the name the shell finds it under. */
const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';

/** The fixture's command line for one scenario, as an interactive shell reads it. */
const command = (scenario: string) => `${runtime} ${fixture} ${scenario}`;

/** A step that prints the last status, and the expectation that waits until the shell printed it. */
const status = String.raw`echo status=$? done-$((40+2))\n`;

/**
 * The shell command that prints the terminal modes raw mode turns off, each as `stty -a` names it
 * with a leading `-` when it is off, in one sorted line, as core's shutdown tests compare them.
 */
const ttyModes = String.raw`stty -a | tr -s ' ;' '\n\n' | grep -E '^-?(icanon|echo|isig|iexten|icrnl|ixon|opost)$' | LC_ALL=C sort | tr '\n' ' '`;

/**
 * Runs one scenario on a real terminal under `sh` with no core dump, then prints the status it
 * ended with and the raw-mode flags before and after it ran.
 */
function underSh(scenario: string, env: Record<string, string> = {}) {
  return drive(
    [
      'sh',
      '-c',
      [
        `before=$(${ttyModes})`,
        'if command -v prlimit >/dev/null 2>&1; then prlimit --core=1 "$0" "$1" "$2"',
        'else ulimit -c 0; "$0" "$1" "$2"; fi',
        'echo "status=$?"',
        `echo "modes-before=$before"`,
        `echo "modes-after=$(${ttyModes})"`,
        'echo @@DONE@@',
      ].join('; '),
      runtime,
      fixture,
      scenario,
    ],
    { NO_COLOR: '1', ...env },
  );
}

/** Whether the process `pid` names is still running; an unnamed one is not. */
function alive(pid: number | undefined): boolean {
  if (pid === undefined) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** The raw-mode flags one line of a transcript names after `label=`. */
function modesOf(transcript: string, label: string): string {
  const modes = new RegExp(`${label}=(?<modes>[^\\r\\n]*)`, 'u').exec(transcript)?.groups?.modes;
  if (modes === undefined) {
    throw new Error(`The transcript names no ${label}:\n${transcript}`);
  }
  return modes.trim();
}

/** The process id the fixture announced with `ready:<pid>:`. */
function announcedPid(transcript: string): number {
  const pid = /ready:(?<pid>\d+):/u.exec(transcript)?.groups?.pid;
  if (pid === undefined) {
    throw new Error(`The fixture announced no process id:\n${transcript}`);
  }
  return Number(pid);
}

test.skipIf(zsh === undefined)(
  'Ctrl-C at a question ends the process by SIGINT, so a shell loop running it stops',
  async () => {
    const shell = drive(['zsh', '-f', '-i'], { NO_COLOR: '1' });
    try {
      await shell.expect('%');
      shell.send(String.raw`for round in 1 2; do echo round-$round; ${command('text')}; done\n`);
      await shell.expect('Service port');
      shell.send(String.raw`\x03`);
      await shell.expect('%');
      shell.send(status);
      const transcript = await shell.expect('done-42');
      expect(transcript).toContain('status=130 done-42');
      expect(transcript).not.toContain('round-2');
    } finally {
      await shell.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'keys typed after Ctrl-C in the same read are dropped, as a cooked terminal flushes them',
  async () => {
    const terminal = underSh('text');
    try {
      await terminal.expect('Service port');
      terminal.send(String.raw`\x03\r`);
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('status=130');
      expect(ended).not.toContain('ANSWER');
    } finally {
      await terminal.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  String.raw`Ctrl-\ at a question ends the process by SIGQUIT with the terminal cooked and the cursor shown`,
  async () => {
    const terminal = underSh('text');
    try {
      await terminal.expect('Service port');
      terminal.send(String.raw`\x1c`);
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('status=131');
      expect(ended).toContain('\u001B[?25h');
      expect(modesOf(ended, 'modes-after')).toBe(modesOf(ended, 'modes-before'));
    } finally {
      await terminal.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'Ctrl-Z at a question suspends with the frame erased and the cursor shown, and fg redraws it',
  async () => {
    const shell = drive(['zsh', '-f', '-i'], { NO_COLOR: '1' });
    try {
      await shell.expect('%');
      shell.send(String.raw`${command('text')}\n`);
      await shell.expect('Service port');
      shell.send(String.raw`\x1a`);
      const stopped = await shell.expect('suspended');
      expect(stopped).toContain('\u001B[J\u001B[?25h');
      await shell.expect('%');
      shell.send(String.raw`fg\n`);
      await expect(shell.expect('Service port')).resolves.toContain('Service port');
      shell.send(String.raw`8080\r`);
      const answered = await shell.expect('EXIT:0 cooked:true');
      expect(answered).toContain('ANSWER:"8080"');
      await shell.expect('%');
      shell.send(status);
      await expect(shell.expect('done-42')).resolves.toContain('status=0 done-42');
    } finally {
      await shell.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'two Ctrl-Z keys in one read suspend the process once, as at a cooked terminal',
  async () => {
    const shell = drive(['zsh', '-f', '-i'], { NO_COLOR: '1' });
    try {
      await shell.expect('%');
      shell.send(String.raw`${command('text')}\n`);
      await shell.expect('Service port');
      shell.send(String.raw`\x1a\x1a`);
      await shell.expect('suspended');
      await shell.expect('%');
      shell.send(String.raw`fg\n`);
      await shell.expect('Service port');
      shell.send(String.raw`8080\r`);
      await expect(shell.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:"8080"');
    } finally {
      await shell.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'keys typed after Ctrl-Z in the same read are dropped, and the question asks again after fg',
  async () => {
    const shell = drive(['zsh', '-f', '-i'], { NO_COLOR: '1' });
    try {
      await shell.expect('%');
      shell.send(String.raw`${command('text')}\n`);
      await shell.expect('Service port');
      shell.send(String.raw`\x1a8080\r`);
      await shell.expect('suspended');
      await shell.expect('%');
      shell.send(String.raw`fg\n`);
      await shell.expect('Service port');
      shell.send(String.raw`5000\r`);
      await expect(shell.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:"5000"');
    } finally {
      await shell.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'part of a key read before Ctrl-Z is dropped, so a key typed after fg reads as itself',
  async () => {
    const shell = drive(['zsh', '-f', '-i'], { NO_COLOR: '1' });
    try {
      await shell.expect('%');
      shell.send(String.raw`${command('text')}\n`);
      await shell.expect('Service port');
      // The start of an arrow key's sequence, then Ctrl-Z in a later read.
      shell.send(String.raw`\x1b[`);
      await new Promise((resolve) => setTimeout(resolve, 200));
      shell.send(String.raw`\x1a`);
      await shell.expect('suspended');
      await shell.expect('%');
      shell.send(String.raw`fg\n`);
      await shell.expect('Service port');
      shell.send(String.raw`A\r`);
      await expect(shell.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:"A"');
    } finally {
      await shell.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'part of a character read with Ctrl-Z is dropped, so a character typed after fg reads as itself',
  async () => {
    const shell = drive(['zsh', '-f', '-i'], { NO_COLOR: '1' });
    try {
      await shell.expect('%');
      shell.send(String.raw`${command('text')}\n`);
      await shell.expect('Service port');
      // Ctrl-Z, then the first byte of é's two UTF-8 bytes, in one read.
      shell.send(String.raw`\x1a\xc3`);
      await shell.expect('suspended');
      await shell.expect('%');
      shell.send(String.raw`fg\n`);
      await shell.expect('Service port');
      shell.send(String.raw`\xc3\xa9\r`);
      await expect(shell.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:"é"');
    } finally {
      await shell.close();
    }
  },
);

test.skipIf(zsh === undefined).each([
  { ending: 'kill -TERM', env: { PROMPT_ANNOUNCE: '1' }, status: 143 },
  { ending: 'process.exit()', env: { PROMPT_EXIT_AFTER: '300' }, status: 3 },
])(
  'a process that $ending ends mid-question leaves the terminal cooked with the cursor shown',
  async ({ env, status: code }) => {
    const terminal = underSh('text', env);
    try {
      const asked = await terminal.expect('Service port');
      if (env.PROMPT_ANNOUNCE === '1') {
        process.kill(announcedPid(asked), 'SIGTERM');
      }
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain(`status=${String(code)}`);
      expect(ended).toContain('\u001B[?25h');
      expect(modesOf(ended, 'modes-after')).toBe(modesOf(ended, 'modes-before'));
    } finally {
      await terminal.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'a process that exits while the editor runs ends it, removes its folder, and writes no control over it',
  async () => {
    const folder = mkdtempSync(join(tmpdir(), 'editor-exit-'));
    const script = join(folder, 'edit.sh');
    // The editor names its process and file, asks its parent to exit, and runs until it is ended.
    // It ignores the hangup the terminal's session sends as it closes, so only SIGTERM ends it.
    writeFileSync(
      script,
      'trap "" HUP\nprintf "EDITOR-RUNNING:%s:%s:\\n" "$$" "$1" >&2\nkill -USR2 $PPID\nwhile :; do sleep 0.1; done\n',
    );
    const terminal = underSh('editor', {
      EDITOR: `sh '${script}'`,
      PROMPT_EXIT_ON_USR2: '1',
      TMPDIR: folder,
      VISUAL: '',
    });
    let editorPid: number | undefined = undefined;
    try {
      await terminal.expect('Press Enter to open your editor');
      terminal.send(String.raw`\r`);
      const ended = await terminal.expect('@@DONE@@');
      expect(ended).toContain('status=3');
      const running = /EDITOR-RUNNING:(?<pid>\d+):(?<file>[^:]+):/u.exec(ended)?.groups;
      expect(running).toBeDefined();
      editorPid = Number(running?.pid);
      expect(existsSync(dirname(running?.file ?? folder))).toBe(false);
      // The question's shutdown handler sent the editor SIGTERM, so it ends without a later signal.
      await vi.waitFor(
        () => {
          expect(alive(editorPid)).toBe(false);
        },
        { timeout: 5000 },
      );
      expect(ended.slice(ended.indexOf('EDITOR-RUNNING'))).not.toContain('\u001B[?2004l');
      expect(modesOf(ended, 'modes-after')).toBe(modesOf(ended, 'modes-before'));
    } finally {
      // An editor a broken shutdown left running is ended here, by the PID it printed.
      if (editorPid !== undefined && alive(editorPid)) {
        process.kill(editorPid, 'SIGKILL');
      }
      await terminal.close();
      rmSync(folder, { force: true, recursive: true });
    }
  },
);
