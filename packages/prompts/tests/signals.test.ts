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
 *   answer and leaves the terminal cooked.
 * - A process that ends mid-question, by `kill -TERM` or by `process.exit()`, leaves the terminal
 *   cooked with the cursor shown.
 */
import { expect, test } from 'vite-plus/test';

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
