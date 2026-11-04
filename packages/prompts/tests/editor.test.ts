import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { Application, FatalError } from '@loomcli/core';
import { editor, EditorError, text } from '@loomcli/prompts';
import { mockProcess } from '@loomcli/testing';
import { expect, test, vi } from 'vite-plus/test';

test('editor lends cooked stdin, seeds a private file and returns saved UTF-8 exactly', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
  let file = '';
  let answer: unknown = undefined;
  try {
    const mock = mockProcess({
      env: { TMPDIR: folder, VISUAL: 'code --wait' },
      programs: {
        '/bin/sh': (call) => {
          file = call.args[3] ?? '';
          expect(call.args).toEqual([
            '-c',
            'exec 1>&2; exec code --wait "$@"',
            'code --wait',
            file,
          ]);
          expect(call.input).toBe('');
          expect(mock.stdin.isRaw).toBe(false);
          expect(statSync(dirname(file)).mode & 0o777).toBe(0o700);
          expect(statSync(file).mode & 0o777).toBe(0o600);
          expect(readFileSync(file, 'utf8')).toBe('seed');
          writeFileSync(file, '\uFEFFFirst\nSecond\n');
          return {};
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      answer = await editor(context, { default: 'seed', extension: 'md', message: 'Notes' });
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(answer).toBe('\uFEFFFirst\nSecond\n');
    expect(file.endsWith('/answer.md')).toBe(true);
    expect(existsSync(dirname(file))).toBe(false);
    expect(mock.stderr.text).toContain('(+1 line)');
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test.each([
  [{ EDITOR: 'editor', TERM: 'dumb', VISUAL: 'visual' }, 'visual'],
  [{ EDITOR: 'editor', VISUAL: ' \t' }, 'editor'],
  [{ EDITOR: ' ', VISUAL: '' }, 'vi'],
] satisfies [Record<string, string>, string][])(
  'editor resolution %j selects %s',
  async (env, command) => {
    const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
    try {
      const mock = mockProcess({
        env: { ...env, TMPDIR: folder },
        programs: {
          '/bin/sh': ({ args }) => {
            expect(args[2]).toBe(command);
            return {};
          },
        },
        terminal: { columns: 80, keys: ['\r'], rows: 24 },
      });
      const app = new Application('edit').action(async (context) => {
        await expect(editor(context, { default: 'seed', message: 'Notes' })).resolves.toBe('seed');
      });
      await expect(app.run({ process: mock })).resolves.toBe(0);
    } finally {
      rmSync(folder, { force: true, recursive: true });
    }
  },
);

test.each([1, 2, 126, 127])(
  'editor exit %s has the exact failure and cleans up',
  async (status) => {
    const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
    let file = '';
    try {
      const mock = mockProcess({
        env: { EDITOR: 'nano', TMPDIR: folder },
        programs: {
          '/bin/sh': ({ args }) => {
            file = args[3] ?? '';
            return { code: status };
          },
        },
        terminal: { columns: 80, keys: ['\r'], rows: 24 },
      });
      let caught: unknown = undefined;
      const app = new Application('edit').action(async (context) => {
        try {
          await editor(context, { message: 'Notes' });
        } catch (error) {
          caught = error;
          throw error;
        }
      });
      await expect(app.run({ process: mock })).resolves.toBe(1);
      expect(caught).toBeInstanceOf(EditorError);
      if (!(caught instanceof EditorError)) {
        throw caught;
      }
      expect(caught.editor).toBe('nano');
      expect(caught.status).toBe(status);
      expect(EditorError.code).toBe('editor-failed');
      expect(caught.message).toBe(
        status >= 126
          ? 'The editor "nano" could not start. Set VISUAL or EDITOR to an editor you have installed, then run the command again.'
          : `The editor "nano" exited with code ${status}, so the question has no answer. To answer it, set VISUAL or EDITOR to another editor if you need one, then run the command again.`,
      );
      expect(existsSync(dirname(file))).toBe(false);
    } finally {
      rmSync(folder, { force: true, recursive: true });
    }
  },
);

test.each(['validation', 'missing', 'utf8'] satisfies ('validation' | 'missing' | 'utf8')[])(
  'editor reopens saved text after %s',
  async (rejection) => {
    const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
    let calls = 0;
    let reopened = Buffer.alloc(0);
    try {
      const mock = mockProcess({
        env: { TMPDIR: folder },
        programs: {
          '/bin/sh': ({ args }) => {
            const file = args[3] ?? '';
            calls += 1;
            if (calls === 1) {
              if (rejection === 'missing') {
                rmSync(file);
              } else {
                writeFileSync(file, rejection === 'utf8' ? Buffer.from([255]) : 'bad');
              }
            } else {
              reopened = readFileSync(file);
              writeFileSync(file, 'good\n');
            }
            return {};
          },
        },
        terminal: { columns: 80, keys: ['ignored\r\r', '\r'], rows: 24 },
      });
      const app = new Application('edit').action(async (context) => {
        await expect(
          editor(context, {
            default: 'seed',
            message: 'Notes',
            validate: {
              '~standard': {
                validate: (value: unknown) =>
                  value === 'bad'
                    ? { issues: [{ message: 'Try again.' }] }
                    : { value: String(value) },
                vendor: 'test',
                version: 1,
              },
            },
          }),
        ).resolves.toBe('good\n');
      });
      await expect(app.run({ process: mock })).resolves.toBe(0);
      expect(calls).toBe(2);
      const expected = {
        missing: Buffer.from('seed'),
        utf8: Buffer.from([255]),
        validation: Buffer.from('bad'),
      };
      expect(reopened).toEqual(expected[rejection]);
      const issues = {
        missing: "The editor removed the answer's file.",
        utf8: 'The saved answer is not UTF-8 text.',
        validation: 'Try again.',
      };
      expect(mock.stderr.text).toContain(issues[rejection]);
    } finally {
      rmSync(folder, { force: true, recursive: true });
    }
  },
);

test.each(['\u0003', '\u0004'])('editor cancels while waiting with %j', async (keys) => {
  const mock = mockProcess({ terminal: { columns: 80, keys: [keys], rows: 24 } });
  const app = new Application('edit').action(async (context) => {
    await editor(context, { message: 'Notes' });
  });
  await expect(app.run({ process: mock })).resolves.toBe(130);
  expect(mock.stdin.isRaw).toBe(false);
  expect(mock.stderr.text).toContain('cancelled');
});

test('editor never spawns with interaction off or in invoke', async () => {
  const app = new Application('edit')
    .option('notes', { type: 'string' })
    .action(async (context) => {
      await expect(editor(context, { message: 'Notes', option: 'notes' })).resolves.toBe(
        'supplied',
      );
    });
  const mock = mockProcess({ argv: ['--notes', 'supplied'] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  const invocation = await app.invoke(
    [],
    { options: { notes: 'supplied' } },
    { process: mockProcess() },
  );
  expect(invocation.status).toBe('completed');
});

test.each([
  ['', '? Notes · empty\n'],
  ['\uFEFF\n\u0085\n', '? Notes · empty\n'],
  ['\nFirst\r\nSecond\r\n', '? Notes · First (+2 lines)\n'],
  ['First\n', '? Notes · First\n'],
])('editor summarizes saved text %j on one answered row', async (saved, expected) => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
  try {
    const mock = mockProcess({
      env: { NO_COLOR: '1', TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          writeFileSync(args[3] ?? '', saved);
          return {};
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await expect(editor(context, { message: 'Notes' })).resolves.toBe(saved);
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(stripVTControlCharacters(mock.stderr.text)).toContain(expected);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('file creation failure names TMPDIR and leaves no folder', async () => {
  const mock = mockProcess({
    env: { TMPDIR: '/loom-missing-editor-test' },
    terminal: { columns: 80, keys: ['\r'], rows: 24 },
  });
  const app = new Application('edit').action(async (context) => {
    await editor(context, { message: 'Notes' });
  });
  await expect(app.run({ process: mock })).resolves.toBe(1);
  expect(mock.stderr.text).toContain(
    'Cannot write the editor\'s file in "/loom-missing-editor-test" (ENOENT). Set TMPDIR to a folder you can write to, then run the command again.',
  );
});

test('a supplied linked value seeds the editor ahead of its question default', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
  try {
    const mock = mockProcess({
      argv: ['--notes', 'supplied'],
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          expect(readFileSync(args[3] ?? '', 'utf8')).toBe('supplied');
          return {};
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit')
      .option('notes', { default: 'declared', type: 'string' })
      .action(async (context) => {
        await expect(
          editor(context, { default: 'question', message: 'Notes', option: 'notes' }),
        ).resolves.toBe('supplied');
      });
    await expect(app.run({ process: mock })).resolves.toBe(0);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('cancellation while editing ends the child and removes its folder', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
  let file = '';
  const started = Promise.withResolvers<void>();
  try {
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          file = args[3] ?? '';
          started.resolve();
          return new Promise(() => {});
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await editor(context, { message: 'Notes' });
    });
    const run = app.run({ process: mock });
    await started.promise;
    mock.signals.raise('SIGINT');
    await expect(run).resolves.toBe(130);
    expect(existsSync(dirname(file))).toBe(false);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('failure closing the input region aborts the editor spawn and leaves the report last', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
  const started = Promise.withResolvers<void>();
  let file = '';
  const child: { signal?: AbortSignal } = {};
  try {
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args, signal }) => {
          file = args[3] ?? '';
          child.signal = signal;
          started.resolve();
          return new Promise(() => {});
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      void editor(context, { message: 'Notes' }).catch(() => {});
      await started.promise;
      throw new FatalError('failed-during-edit');
    });
    await expect(app.run({ process: mock })).resolves.toBe(1);
    expect(child.signal?.aborted).toBe(true);
    expect(existsSync(dirname(file))).toBe(false);
    expect(
      stripVTControlCharacters(mock.stderr.text).trimEnd().endsWith('failed-during-edit'),
    ).toBe(true);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test('an unstarted shell reports EditorError without an exit status and cleans up', async () => {
  const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
  let file = '';
  const caught: { error?: unknown } = {};
  try {
    const mock = mockProcess({
      env: { EDITOR: 'nano', TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          file = args[3] ?? '';
          throw new Error('unstarted');
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      try {
        await editor(context, { message: 'Notes' });
      } catch (error) {
        caught.error = error;
        throw error;
      }
    });
    await expect(app.run({ process: mock })).resolves.toBe(1);
    expect(caught.error).toBeInstanceOf(EditorError);
    expect(caught.error).toMatchObject({ editor: 'nano', status: undefined });
    expect(existsSync(dirname(file))).toBe(false);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
});

test.each([false, true])(
  'noninteractive unsupplied editor fails without spawning, linked %s',
  async (linked) => {
    const app = new Application('edit')
      .option('notes', { type: 'string' })
      .action(async (context) => {
        await editor(
          context,
          linked ? { message: 'Notes', option: 'notes' } : { message: 'Notes' },
        );
      });
    const mock = mockProcess();
    await expect(app.run({ process: mock })).resolves.toBe(linked ? 2 : 1);
    const invoked = await app.invoke([], {}, { process: mockProcess() });
    expect(invoked).toMatchObject({ exitCode: linked ? 2 : 1, status: 'failed' });
  },
);

/** Runs `body` with a private folder for TMPDIR, removed when it settles. */
async function inFolder(body: (folder: string) => Promise<void>): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'editor-test-'));
  try {
    await body(folder);
  } finally {
    rmSync(folder, { force: true, recursive: true });
  }
}

test('an editor asked at once with a text question discards the rest of the read its Enter ended', async () => {
  await inFolder(async (folder) => {
    let spawned = 0;
    let typed: unknown = undefined;
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': () => {
          spawned += 1;
          return {};
        },
      },
      // The later read is Ctrl-D, typed once the editor question shows.
      terminal: { columns: 80, keys: [['42\r\r', '\u0004']], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      const asked = text(context, { message: 'Port' });
      await Promise.all([
        (async () => {
          typed = await asked;
        })(),
        editor(context, { message: 'Notes' }),
      ]);
    });
    await expect(app.run({ process: mock })).resolves.toBe(130);
    expect(typed).toBe('42');
    expect(spawned).toBe(0);
  });
});

test('an editor asked after a text question discards the keys left in the read that answered it', async () => {
  await inFolder(async (folder) => {
    let spawned = 0;
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': () => {
          spawned += 1;
          return {};
        },
      },
      terminal: { columns: 80, keys: ['42\r\r', '\u0004'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await expect(text(context, { message: 'Port' })).resolves.toBe('42');
      await editor(context, { message: 'Notes' });
    });
    await expect(app.run({ process: mock })).resolves.toBe(130);
    expect(spawned).toBe(0);
  });
});

test('a removed file comes back with the bytes it held when that editor opened', async () => {
  await inFolder(async (folder) => {
    let calls = 0;
    let reopened = Buffer.alloc(0);
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          const file = args[3] ?? '';
          calls += 1;
          if (calls === 1) {
            writeFileSync(file, Buffer.from([255]));
          } else if (calls === 2) {
            rmSync(file);
          } else {
            reopened = readFileSync(file);
            writeFileSync(file, 'good\n');
          }
          return {};
        },
      },
      terminal: { columns: 80, keys: ['\r', '\r', '\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await expect(editor(context, { default: 'seed', message: 'Notes' })).resolves.toBe('good\n');
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(calls).toBe(3);
    expect(reopened).toEqual(Buffer.from([255]));
  });
});

test('a file the question cannot read after the editor exits is an issue, and Enter reopens what it last held', async () => {
  await inFolder(async (folder) => {
    let calls = 0;
    let reopened = '';
    let mode = 0;
    const mock = mockProcess({
      env: { NO_COLOR: '1', TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          const file = args[3] ?? '';
          calls += 1;
          if (calls === 1) {
            rmSync(file);
            mkdirSync(file);
          } else {
            reopened = readFileSync(file, 'utf8');
            mode = statSync(file).mode & 0o777;
            writeFileSync(file, 'good\n');
          }
          return {};
        },
      },
      terminal: { columns: 120, keys: ['\r', '\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await expect(editor(context, { default: 'seed', message: 'Notes' })).resolves.toBe('good\n');
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(calls).toBe(2);
    expect(reopened).toBe('seed');
    expect(mode).toBe(0o600);
    expect(stripVTControlCharacters(mock.stderr.text)).toContain(
      "The question cannot read the answer's file (EISDIR). Save the answer as a file before you close the editor.",
    );
  });
});

test('a suspend and resume while the editor runs enter no raw mode, hide no cursor, and take no entry', async () => {
  await inFolder(async (folder) => {
    let start = 0;
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          start = mock.stderr.text.length;
          mock.signals.raise('SIGTSTP');
          expect(mock.stdin.isRaw).toBe(false);
          writeFileSync(args[3] ?? '', 'good\n');
          return {};
        },
      },
      // A resume that entered raw mode would take an entry, and none is left for it.
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await expect(editor(context, { message: 'Notes' })).resolves.toBe('good\n');
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(mock.stdin.isRaw).toBe(false);
    expect(mock.stderr.text.slice(start)).not.toContain('\u001b[?25l');
  });
});

test('a shutdown that cuts the run off while the editor runs ends it and removes its folder', async () => {
  await inFolder(async (folder) => {
    let file = '';
    const child: { signal?: AbortSignal } = {};
    const facts: { removed?: boolean } = {};
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args, signal }) => {
          file = args[3] ?? '';
          child.signal = signal;
          // The first SIGTERM starts the shutdown, and the second ends it at once.
          // Its onShutdown handlers run inside that raise, before the question's own cleanup.
          mock.signals.raise('SIGTERM');
          mock.signals.raise('SIGTERM');
          facts.removed = !existsSync(dirname(file));
          return new Promise(() => {});
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await editor(context, { message: 'Notes' });
    });
    void app.run({ process: mock });
    await vi.waitFor(() => {
      expect(mock.endedBy).toBe('SIGTERM');
    });
    expect(child.signal?.aborted).toBe(true);
    expect(facts.removed).toBe(true);
  });
});

test('the cancelled line waits for the lend and lands below what the editor wrote', async () => {
  await inFolder(async (folder) => {
    const mock = mockProcess({
      env: { NO_COLOR: '1', TMPDIR: folder },
      programs: {
        '/bin/sh': () => {
          mock.stderr.write('EDITOR-SCREEN');
          mock.signals.raise('SIGINT');
          return new Promise(() => {});
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('edit').action(async (context) => {
      await editor(context, { message: 'Notes' });
    });
    await expect(app.run({ process: mock })).resolves.toBe(130);
    const after = mock.stderr.text.slice(mock.stderr.text.indexOf('EDITOR-SCREEN'));
    expect(after).not.toContain('\u001b[J');
    expect(after).not.toContain('\u001b[1A');
    expect(stripVTControlCharacters(after)).toBe('EDITOR-SCREEN\n? Notes · cancelled\n');
  });
});

test('the folder is named for the application and six characters, inside TMPDIR', async () => {
  await inFolder(async (folder) => {
    let file = '';
    const mock = mockProcess({
      env: { TMPDIR: folder },
      programs: {
        '/bin/sh': ({ args }) => {
          file = args[3] ?? '';
          return {};
        },
      },
      terminal: { columns: 80, keys: ['\r'], rows: 24 },
    });
    const app = new Application('notes-app').action(async (context) => {
      await editor(context, { message: 'Notes' });
    });
    await expect(app.run({ process: mock })).resolves.toBe(0);
    expect(dirname(dirname(file))).toBe(folder);
    expect(basename(dirname(file))).toMatch(/^notes-app-[\w]{6}$/u);
  });
});

test.each([
  ['.md', 'answer.md'],
  ['', 'answer'],
  [undefined, 'answer'],
] satisfies [string | undefined, string][])(
  'the extension %j names the file %s',
  async (extension, name) => {
    await inFolder(async (folder) => {
      let file = '';
      const mock = mockProcess({
        env: { TMPDIR: folder },
        programs: {
          '/bin/sh': ({ args }) => {
            file = args[3] ?? '';
            return {};
          },
        },
        terminal: { columns: 80, keys: ['\r'], rows: 24 },
      });
      const app = new Application('edit').action(async (context) => {
        await editor(
          context,
          extension === undefined ? { message: 'Notes' } : { extension, message: 'Notes' },
        );
      });
      await expect(app.run({ process: mock })).resolves.toBe(0);
      expect(basename(file)).toBe(name);
    });
  },
);
