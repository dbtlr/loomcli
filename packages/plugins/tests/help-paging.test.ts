/*
 * Acceptance plan for help paging (docs/plugins/help.md#help-paging), run in-process on a mock whose
 * terminal reports rows, with `/bin/sh` scripted as the pager's shell.
 *
 * - Off by default. With `help()`, a long page prints to stdout and starts no program.
 * - Paged. With `help({ paging: true })`, `-h` and `--help` hand `/bin/sh` the arguments `-c` and
 *   `exec ` followed by the pager, and the page as input: exactly the bytes the run prints with
 *   paging off. Nothing of the page reaches stdout, and the run exits 0. `LESS` is `FRX` when the
 *   environment holds none and the operator's value, an empty one included, when it holds one.
 * - Not paged. A pipe, `TERM` unset, empty, or `dumb`, CI, a page shorter than the rows, and an
 *   empty, blank, or `cat` `PAGER` print the page as paging off does. A mock terminal always has
 *   rows, so unknown rows are not reachable here.
 * - Cannot start. A shell that cannot start, and exit 126 or 127, print the page unpaged and exit 0.
 * - The exit. Any other exit code of the pager leaves the run at 0.
 * - Cancellation. A run cancelled while the pager is open ends it and resolves 130.
 */

import { Application, Command } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { mockProcess } from '@loomcli/testing';
import type { MockFields, ProgramCall } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/** One of the notes Commands, which does nothing. */
function note(name: string) {
  return new Command(name, { description: `Run ${name} on the notes.` }).action(() => undefined);
}

/** An application whose extended page runs to more than ten lines. */
function notes(paging: boolean | undefined) {
  return new Application('notes', {
    description: 'Keep notes in a folder.',
    plugins: [paging === undefined ? help() : help({ paging })],
  })
    .command(note('add'))
    .command(note('edit'))
    .command(note('list'))
    .command(note('move'))
    .command(note('remove'))
    .command(note('show'))
    .command(note('sync'))
    .command(note('tag'));
}

/** A terminal of ten rows and eighty columns, with a TERM that draws. */
const terminal: MockFields = {
  env: { TERM: 'xterm-256color' },
  terminal: { columns: 80, rows: 10 },
};

/** The page one run prints to stdout with paging off. */
async function unpaged(argv: readonly string[], fields: MockFields = terminal) {
  const mock = mockProcess({ ...fields, argv });
  await expect(notes(undefined).run({ process: mock })).resolves.toBe(0);
  return mock.stdout.text;
}

/** One paged run, with `/bin/sh` answering `answer` and each call it received recorded. */
async function paged(argv: readonly string[], fields: MockFields = terminal) {
  const calls: ProgramCall[] = [];
  const mock = mockProcess({
    ...fields,
    argv,
    programs: {
      '/bin/sh': (call) => {
        calls.push(call);
        return {};
      },
    },
  });
  const code = await notes(true).run({ process: mock });
  return { calls, code, mock };
}

test.each([['--help'], ['-h']])(
  'with paging on, %s on a terminal shorter than the page hands the page to less',
  async (flag) => {
    const page = await unpaged([flag]);
    expect(page.split('\n').length - 1).toBeGreaterThanOrEqual(10);
    const { calls, code, mock } = await paged([flag]);
    expect(code).toBe(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual(['-c', 'exec less']);
    expect(calls[0]?.input).toBe(page);
    expect(calls[0]?.env.LESS).toBe('FRX');
    expect(mock.stdout.text).toBe('');
  },
);

test('with paging off by default, a long page prints to stdout and starts no program', async () => {
  const page = await unpaged(['--help']);
  const mock = mockProcess({ ...terminal, argv: ['--help'] });
  await expect(notes(undefined).run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe(page);
  await expect(
    notes(false).run({ process: mockProcess({ ...terminal, argv: ['--help'] }) }),
  ).resolves.toBe(0);
});

test.each<{ name: string; fields: MockFields }>([
  { fields: { env: { TERM: 'xterm-256color' } }, name: 'stdout is a pipe' },
  { fields: { env: {}, terminal: { columns: 80, rows: 10 } }, name: 'TERM is unset' },
  { fields: { env: { TERM: '' }, terminal: { columns: 80, rows: 10 } }, name: 'TERM is empty' },
  { fields: { env: { TERM: 'dumb' }, terminal: { columns: 80, rows: 10 } }, name: 'TERM is dumb' },
  {
    fields: { env: { CI: 'true', TERM: 'xterm-256color' }, terminal: { columns: 80, rows: 10 } },
    name: 'the run is under CI',
  },
  {
    fields: { env: { TERM: 'xterm-256color' }, terminal: { columns: 80, rows: 60 } },
    name: 'the page is shorter than the rows',
  },
  {
    fields: { env: { PAGER: '', TERM: 'xterm-256color' }, terminal: { columns: 80, rows: 10 } },
    name: 'PAGER is empty',
  },
  {
    fields: { env: { PAGER: '  ', TERM: 'xterm-256color' }, terminal: { columns: 80, rows: 10 } },
    name: 'PAGER is blank',
  },
  {
    fields: { env: { PAGER: 'cat', TERM: 'xterm-256color' }, terminal: { columns: 80, rows: 10 } },
    name: 'PAGER is cat',
  },
  {
    fields: {
      env: { PAGER: ' cat ', TERM: 'xterm-256color' },
      terminal: { columns: 80, rows: 10 },
    },
    name: 'PAGER is cat with spaces',
  },
])('with paging on, the page prints as paging off prints it when $name', async ({ fields }) => {
  const page = await unpaged(['--help'], fields);
  // No /bin/sh script, so a pager start would fail the run with the mock's sentence.
  const mock = mockProcess({ ...fields, argv: ['--help'] });
  await expect(notes(true).run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toBe(page);
});

test('CI=false lets help page again', async () => {
  const { calls, code } = await paged(['--help'], {
    env: { CI: 'false', TERM: 'xterm-256color' },
    terminal: { columns: 80, rows: 10 },
  });
  expect(code).toBe(0);
  expect(calls).toHaveLength(1);
});

test('a page with exactly as many lines as the rows is paged', async () => {
  const page = await unpaged(['--help']);
  const rows = page.split('\n').length - 1;
  const { calls } = await paged(['--help'], {
    env: { TERM: 'xterm-256color' },
    terminal: { columns: 80, rows },
  });
  expect(calls).toHaveLength(1);
});

test.each([
  { env: { LESS: '-R' }, less: '-R' },
  { env: { LESS: '' }, less: '' },
])('the operator\'s LESS of "$less" reaches the pager as it is', async ({ env, less }) => {
  const { calls } = await paged(['--help'], {
    env: { ...env, TERM: 'xterm-256color' },
    terminal: { columns: 80, rows: 10 },
  });
  expect(calls[0]?.env.LESS).toBe(less);
});

test('a PAGER with arguments reaches the shell behind exec as the operator wrote it', async () => {
  const { calls } = await paged(['--help'], {
    env: { PAGER: "'/opt/my pager/most' -s", TERM: 'xterm-256color' },
    terminal: { columns: 80, rows: 10 },
  });
  expect(calls[0]?.args).toEqual(['-c', "exec '/opt/my pager/most' -s"]);
});

/** A run whose `/bin/sh` answers with `answer`, or throws as a shell that cannot start. */
async function pagedWith(sh: () => { code: number } | never) {
  const page = await unpaged(['--help']);
  const mock = mockProcess({ ...terminal, argv: ['--help'], programs: { '/bin/sh': sh } });
  const code = await notes(true).run({ process: mock });
  return { code, page, stdout: mock.stdout.text };
}

test.each([126, 127])(
  'a shell that exits %d could not run the pager, so the page prints unpaged',
  async (status) => {
    const { code, page, stdout } = await pagedWith(() => ({ code: status }));
    expect(code).toBe(0);
    expect(stdout).toBe(page);
  },
);

test('a shell that cannot start leaves the page unpaged', async () => {
  const { code, page, stdout } = await pagedWith(() => {
    throw new Error('spawn /bin/sh ENOENT');
  });
  expect(code).toBe(0);
  expect(stdout).toBe(page);
});

test.each([1, 3, 141])(
  'a pager that exits %d leaves the run at 0 and prints nothing',
  async (status) => {
    const { code, stdout } = await pagedWith(() => ({ code: status }));
    expect(code).toBe(0);
    expect(stdout).toBe('');
  },
);

test('a run cancelled while the pager is open ends the pager and resolves 130', async () => {
  let ended: Promise<void> | undefined = undefined;
  const controller = new AbortController();
  const mock = mockProcess({
    ...terminal,
    argv: ['--help'],
    programs: {
      '/bin/sh': ({ signal }) => {
        ended = new Promise((resolve) => {
          signal.addEventListener('abort', () => {
            resolve();
          });
        });
        controller.abort();
        return new Promise(() => undefined);
      },
    },
  });
  await expect(notes(true).run({ process: mock, signal: controller.signal })).resolves.toBe(130);
  await expect(ended).resolves.toBeUndefined();
  expect(mock.stdout.text).toBe('');
});

test('SIGINT while the pager is open ends the pager and resolves 130', async () => {
  let ended = false;
  const mock = mockProcess({
    ...terminal,
    argv: ['--help'],
    programs: {
      '/bin/sh': ({ signal }) => {
        signal.addEventListener('abort', () => {
          ended = true;
        });
        mock.signals.raise('SIGINT');
        return new Promise(() => undefined);
      },
    },
  });
  await expect(notes(true).run({ process: mock })).resolves.toBe(130);
  expect(ended).toBe(true);
  expect(mock.stdout.text).toBe('');
});
