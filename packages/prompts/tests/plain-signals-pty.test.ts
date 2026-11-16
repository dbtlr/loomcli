/*
 * Acceptance plan for the interrupt keys at a question asked line by line on a real terminal
 * (docs/libs/prompts.md#asking-line-by-line, ADR-0169), under Node and Bun. A fixture runs inside
 * an interactive zsh with job control, which reports its exit status, and reports whether stdin
 * is in raw mode from its own shutdown, suspend, and resume handlers, after its answer, and at the
 * end of the run:
 *
 * - Ctrl-C at a secret and at a text question asked line by line prints the cancelled line, runs
 *   the action's shutdown handler with raw mode off, and exits with 130, as the same question that
 *   redraws does.
 * - Ctrl-Z at a secret asked line by line stops the process with raw mode off, and `fg` resumes it
 *   with raw mode on again and the asking row printed once more, so the answer typed then is never
 *   echoed, and raw mode is off once the answer is in.
 * - A text answer and a secret typed ahead in one write at the text question's row answer both,
 *   and the secret never reaches the screen.
 * - A process that exits while a secret asked line by line waits, with no signal that aborts the
 *   run first, leaves raw mode in its shutdown handler, before the action's own.
 */
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { zsh } from '../../../scripts/test-pty.js';
import { drive } from '../../../scripts/test-terminal.js';

const fixture = fileURLToPath(new URL('fixtures/plain-signals.mjs', import.meta.url));

/** The runtime the fixture runs on: `LOOM_TEST_RUNTIME`, Node by default. */
const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';

/** The prompt the shell prints, which no fixture line holds. */
const prompt = '@@PROMPT@@ ';

/**
 * An interactive zsh with job control, which reads no startup file. `expect` answers every output
 * the shell has shown so far, through the latest match.
 */
function shell() {
  const tty = drive(['zsh', '-f', '-i'], { PS1: prompt });
  let seen = '';
  const expectSeen = async (pattern: string): Promise<string> => {
    seen += await tty.expect(pattern);
    return seen;
  };
  return {
    close: () => tty.close(),
    /**
     * The exit status of the command that ended last, which the shell prints once its prompt is
     * back, so a command that a signal ends cannot stop the line that prints it.
     */
    async exitStatus(): Promise<string> {
      await tty.expect(prompt);
      tty.send(String.raw`echo "EXIT:$?:END"\r`);
      const shown = await expectSeen('EXIT:<->:END');
      return /EXIT:\d+:END(?![\s\S]*EXIT:\d+:END)/u.exec(shown)?.[0] ?? '';
    },
    expect: expectSeen,
    send(keys: string) {
      tty.send(keys);
    },
  };
}

/** The command line that runs one scenario. */
function command(
  form: 'plain' | 'redraw',
  kind: 'secret' | 'text' | 'typedAhead' | 'exit',
): string {
  return `'${runtime}' '${fixture}' ${form} ${kind}\\r`;
}

test.skipIf(zsh === undefined).each([
  { form: 'plain', kind: 'secret', row: 'Token: ' },
  { form: 'plain', kind: 'text', row: 'Name: ' },
  { form: 'redraw', kind: 'secret', row: 'Token*›' },
  { form: 'redraw', kind: 'text', row: 'Name*›' },
] as const)(
  'Ctrl-C at a $form $kind question prints its cancelled line, runs the shutdown handler, and exits 130',
  async ({ form, kind, row }) => {
    const tty = shell();
    try {
      await tty.expect(prompt);
      tty.send(command(form, kind));
      await tty.expect(row);
      tty.send(String.raw`\x03`);
      const result = await tty.expect('SHUTDOWN raw:(true|false)');
      expect(result).toContain('· cancelled');
      expect(result).toContain('SHUTDOWN raw:false');
      await expect(tty.exitStatus()).resolves.toBe('EXIT:130:END');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'Ctrl-Z at a secret asked line by line stops the process, and fg resumes it with the secret hidden',
  async () => {
    const tty = shell();
    try {
      await tty.expect(prompt);
      tty.send(command('plain', 'secret'));
      await tty.expect('Token: ');
      tty.send(String.raw`\x1a`);
      await tty.expect('SUSPEND raw:false');
      // The shell reports the stopped job once it has the terminal back.
      await tty.expect('suspended');
      await tty.expect(prompt);
      tty.send(String.raw`fg\r`);
      await tty.expect('RESUME raw:true');
      await tty.expect('Token: ');
      tty.send(String.raw`hunter2\r`);
      const result = await tty.expect('DONE raw:(true|false)');
      expect(result).toContain('ANSWER:"hunter2" raw:false');
      // The secret shows only in the fixture's own report of the answer.
      expect(result.split('hunter2')).toHaveLength(2);
      expect(result).toContain('DONE raw:false');
      await expect(tty.exitStatus()).resolves.toBe('EXIT:0:END');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'a secret typed ahead of its turn at a text question never reaches the screen',
  async () => {
    const tty = shell();
    try {
      await tty.expect(prompt);
      tty.send(command('plain', 'typedAhead'));
      await tty.expect('Name: ');
      tty.send(String.raw`bob\rhunter2\rlater\r`);
      await tty.expect('After: ');
      tty.send(String.raw`x\r`);
      const result = await tty.expect('DONE raw:(true|false)');
      // The text question echoes its answer, and the secret's row shows nothing typed.
      expect(result).toMatch(/bob\r?\nToken: \r?\nAfter: /u);
      expect(result).toContain('ANSWER:["bob",7,"x"] raw:false');
      expect(result).not.toContain('hunter2');
      expect(result).not.toContain('later');
      await expect(tty.exitStatus()).resolves.toBe('EXIT:0:END');
    } finally {
      await tty.close();
    }
  },
);

test.skipIf(zsh === undefined)(
  'a process that exits while a secret asked line by line waits leaves raw mode in its shutdown handler',
  async () => {
    const tty = shell();
    try {
      await tty.expect(prompt);
      tty.send(command('plain', 'exit'));
      const result = await tty.expect('SHUTDOWN raw:(true|false)');
      expect(result).toContain('SHUTDOWN raw:false');
      await expect(tty.exitStatus()).resolves.toBe('EXIT:0:END');
    } finally {
      await tty.close();
    }
  },
);
