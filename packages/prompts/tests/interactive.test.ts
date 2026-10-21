/*
 * Acceptance plan for questions (docs/libs/prompts.md#calling-a-question).
 *
 * - PTY. Through the `zpty` driver, a fixture application asks each kind and the screen reads the
 *   frames the Frames and views section describes, with color and with `NO_COLOR`: the hint, typing
 *   over it, clearing back to it, Enter on the hint, Enter with no prefill submitting the empty
 *   string, a rejected answer whose issue stays until the next Enter, then an accepted one, the
 *   answered line left in scrollback, secret's frame unchanged after typing, confirm's three hints,
 *   `yes` and `NO` accepted and `x` answered with `Type y or n.`, and select's start on a matching
 *   prefill, its stop at both ends, a window of seven with both marker lines, and its key help.
 * - Linking. At a terminal, a supplied linked option prefills an asked question with the raw value
 *   from argv, the environment, and the configuration source alike, and a question with
 *   `skipIfSupplied` draws nothing and returns the validated value without calling the question's
 *   validator. Prefill precedence holds across all four rungs, an accepted prefill passes through
 *   the question's validator, an omitted Boolean does not prefill confirm, and a supplied secret
 *   asks empty without `skipIfSupplied`.
 * - Interaction off. Under `--no-input` with stdin and stderr terminals, with piped stdin, with
 *   stderr redirected, under `app.invoke`, under an action's `invoke`, and as an MCP tool call: a
 *   supplied linked option returns its validated value, an unsupplied one fails with the
 *   missing-input sentence and exit 2, by declared name under an invocation by name, and an
 *   unlinked question fails with `InteractionUnavailableError` and exit 1. A piped stdout with
 *   stdin and stderr terminals still asks, and stdout holds no question byte.
 * - Leaving. Ctrl-C at each kind exits 130 and leaves the terminal in cooked mode with the cursor
 *   shown, with and without an installed signals owner, and stdin closing and Ctrl-D on empty input
 *   at a question do the same. A caller's abort while a question waits resolves 130 and restores
 *   the terminal. After every path, the process exits once the run resolves, with nothing left
 *   reading stdin.
 * - Typeahead. `8080` Enter `yes` Enter written in one chunk answers a text question and the
 *   confirm after it, and a view override that draws more rows than the default redraws in place.
 * - Faults. Each rule of Linking an option and an empty `choices` list throw their
 *   `DeclarationError` at the call, and a run reports it with exit 1.
 * - Types. `option` rejects a key the action's `options` lacks, secret rejects `default`, a
 *   select's `default` must be a choice, and the return types of each kind, linked and unlinked,
 *   match the types Calling a question shows.
 * - Views. An application's override of each view changes its frame, and a secret's typed text
 *   never reaches a view.
 * - Width. The select frame clips at `context.columns`, including under `COLUMNS=60` on a terminal
 *   and in the first frame drawn after a resize, and at 80 columns when `columns` is `undefined`,
 *   where the window’s height estimate assumes no wrapping. Its frame data carries `rows` and no
 *   `columns`, and an override of `questionFrame` reads `context.columns`.
 * - Regions. Each question draws in an input region and writes no frame through `out.draw`. A lane
 *   message written from a timer while a question asks lands above the frame, and the frame stays
 *   whole. Two questions started at once ask one after the other, and every key typed for the first
 *   reaches the first.
 */

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { terminal } from './terminal.js';

test('text replaces its default hint and leaves one answered line in a real terminal', async () => {
  const tty = terminal('text', { NO_COLOR: '1' });
  try {
    await expect(tty.expect('Service port*4317')).resolves.toContain('4317');
    tty.send(String.raw`8080\r`);
    const result = await tty.expect('EXIT:0 cooked:true');
    expect(result).toContain('Service port · 8080');
    expect(result).toContain('ANSWER:"8080"');
  } finally {
    await tty.close();
  }
});

test('secret never sends entered text to a frame or its answered line', async () => {
  const tty = terminal('secret', { NO_COLOR: '1' });
  try {
    await tty.expect('Postgres URL');
    tty.send(String.raw`password-sentinel\r`);
    const result = await tty.expect('EXIT:0 cooked:true');
    expect(result).not.toContain('password-sentinel');
    expect(result).toContain('SECRET:true');
    expect(result).not.toContain('hidden');
  } finally {
    await tty.close();
  }
});

test('confirm retries invalid input and retains typed-ahead answers for the next question', async () => {
  const tty = terminal('confirm', { NO_COLOR: '1' });
  try {
    await tty.expect('Install service?*[y/n]');
    tty.send(String.raw`x\r`);
    await tty.expect('Type y or n.');
    tty.send(String.raw`\x7fyes\rNO\r`);
    const result = await tty.expect('EXIT:0 cooked:true');
    expect(result).toContain('Install service? · yes');
    expect(result).toContain('Continue? · no');
    expect(result).toContain('ANSWERS:[true,false]');
  } finally {
    await tty.close();
  }
});

test('select scrolls seven choices without wrapping and honors a matching default', async () => {
  const tty = terminal('select', { NO_COLOR: '1' });
  try {
    await tty.expect('↓ 3 more');
    tty.send(String.raw`\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B\x1b[B`);
    await tty.expect('↑ 3 more');
    tty.send(String.raw`\r`);
    const result = await tty.expect('EXIT:0 cooked:true');
    expect(result).toContain('Backend · choice-9');
    expect(result).toContain('ANSWER:"choice-9"');
  } finally {
    await tty.close();
  }
});

test.each([
  'text',
  'secret',
  'confirm',
  'select',
  'text-signals',
  'secret-signals',
  'confirm-signals',
  'select-signals',
])('Ctrl-C cancels %s, shows the cursor, and restores cooked mode', async (kind) => {
  const tty = terminal(kind, { NO_COLOR: '1' });
  try {
    await tty.expect(
      {
        confirm: 'Install service?',
        secret: 'Postgres URL',
        select: 'Backend',
        text: 'Service port',
      }[kind.replace(/-signals$/u, '')] ?? '',
    );
    tty.send(String.raw`\x03`);
    const result = await tty.expect('EXIT:130 cooked:true');
    expect(result).toContain('cancelled');
    expect(result).toContain('\u001b[?25h');
  } finally {
    await tty.close();
  }
});

test.each([
  ['blank', String.raw`\r`, '""'],
  ['default', String.raw`\r`, '"4317"'],
  ['clear', String.raw`xx\x7f\x7f\r`, '"4317"'],
  ['confirm-no', String.raw`\r`, 'false'],
])('Enter submits the agreed default or blank value: %s', async (scenario, keys, answer) => {
  const tty = terminal(scenario, { NO_COLOR: '1' });
  try {
    await tty.expect(scenario === 'confirm-no' ? 'Install service?' : 'Service port');
    tty.send(keys);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain(`ANSWER:${answer}`);
  } finally {
    await tty.close();
  }
});

test('text retries entered answers and applies its own transformation', async () => {
  const tty = terminal('retry', { NO_COLOR: '1' });
  try {
    await tty.expect('Service port');
    tty.send(String.raw`bad\r`);
    await tty.expect('Use digits.');
    tty.send(String.raw`\x7f\x7f\x7f8080\r`);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:8080');
  } finally {
    await tty.close();
  }
});

test('a chunk typed ahead answers text then confirm', async () => {
  const tty = terminal('typeahead', { NO_COLOR: '1' });
  try {
    await tty.expect('Service port');
    tty.send(String.raw`8080\ryes\r`);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWERS:["8080",true]');
  } finally {
    await tty.close();
  }
});

test.each([
  [{}, '5000', '5000'],
  [{ PROMPT_PORT: '06000' }, '06000', '6000'],
  [{ PROMPT_ARGV: '["--port","07000"]', PROMPT_PORT: '6000' }, '07000', '7000'],
])(
  'an asked link uses raw supplied input before the question default: %j',
  async (env, hint, answer) => {
    const tty = terminal('linked', { NO_COLOR: '1', ...env });
    try {
      await tty.expect(`Service port*${hint}`);
      tty.send(String.raw`\r`);
      await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain(`ANSWER:${answer}`);
    } finally {
      await tty.close();
    }
  },
);

test('a skipped supplied link prints no question or answered line', async () => {
  const tty = terminal('skip', { NO_COLOR: '1', PROMPT_PORT: '6000' });
  try {
    const result = await tty.expect('EXIT:0 cooked:true');
    expect(result).toContain('ANSWER:6000');
    expect(result).not.toContain('Service port');
  } finally {
    await tty.close();
  }
});

test.each(['text', 'secret', 'confirm', 'select', 'secret-signals'])(
  'Ctrl-D on empty %s cancels the run',
  async (kind) => {
    const tty = terminal(kind, { NO_COLOR: '1' });
    try {
      await tty.expect(
        {
          confirm: 'Install service?',
          secret: 'Postgres URL',
          'secret-signals': 'Postgres URL',
          select: 'Backend',
          text: 'Service port',
        }[kind] ?? '',
      );
      tty.send(String.raw`\x04`);
      await expect(tty.expect('EXIT:130 cooked:true')).resolves.toContain('cancelled');
    } finally {
      await tty.close();
    }
  },
);

test('a configuration file supplies the raw prefill before the option transformation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-prompt-config-'));
  const path = join(directory, 'settings.json');
  await writeFile(path, '{"port":"006050"}');
  const tty = terminal('linked', {
    NO_COLOR: '1',
    PROMPT_ARGV: JSON.stringify(['--config', path]),
  });
  try {
    await tty.expect('Service port*006050');
    tty.send(String.raw`\r`);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain('ANSWER:6050');
  } finally {
    await tty.close();
    await rm(directory, { force: true, recursive: true });
  }
});

test('piping stdout still asks while the pipe contains only action output', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-prompt-stdout-'));
  const path = join(directory, 'stdout.txt');
  const tty = terminal('text', { NO_COLOR: '1', PROMPT_STDOUT: path }, { pipeStdout: true });
  try {
    await tty.expect('Service port*4317');
    tty.send(String.raw`\r`);
    await tty.expect('EXIT:0 cooked:true');
  } finally {
    await tty.close();
  }
  try {
    const output = await readFile(path, 'utf8');
    expect(output).toBe('ANSWER:"4317"\nEXIT:0 cooked:true\n');
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test.each([
  [String.raw`ab\x1b\x1b[A\r`, 'ab'],
  [String.raw`\x1bx\r`, 'x'],
  [String.raw`ab\x1b\r`, 'ab'],
  [String.raw`ab\x1b[\r`, 'ab['],
])('Escape ignores itself without consuming the following key: %s', async (keys, answer) => {
  const tty = terminal('blank', { NO_COLOR: '1' });
  try {
    await tty.expect('Service port');
    tty.send(keys);
    await expect(tty.expect('EXIT:0 cooked:true')).resolves.toContain(
      `ANSWER:${JSON.stringify(answer)}`,
    );
  } finally {
    await tty.close();
  }
});

test.each([String.raw`\x1b[\x03`, String.raw`\x1bO\x03`])(
  'Ctrl-C cancels after an incomplete escape sequence: %s',
  async (keys) => {
    const tty = terminal('blank', { NO_COLOR: '1' });
    try {
      await tty.expect('Service port');
      tty.send(keys);
      await expect(tty.expect('EXIT:130 cooked:true')).resolves.toContain('cancelled');
    } finally {
      await tty.close();
    }
  },
);
