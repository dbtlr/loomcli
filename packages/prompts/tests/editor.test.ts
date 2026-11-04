import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { stripVTControlCharacters } from 'node:util';

import { Application, FatalError } from '@loomcli/core';
import { editor, EditorError } from '@loomcli/prompts';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

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
