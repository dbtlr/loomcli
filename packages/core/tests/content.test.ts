import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

test('a named content argument checks a path and hands its action a lazy file handle', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-'));
  try {
    const path = join(directory, 'input.txt');
    await writeFile(path, 'hello\n');
    const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['file', path]);
    expect(result.stderr).toBe('');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toEqual({
      messages: '',
      output: `${JSON.stringify({ kind: 'file', name: path, path, text: 'hello\n' })}\n`,
      status: 'completed',
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test.each(['header-break', 'header-destroy'])(
  'file content can stop after a header and repeatedly reopen sources: %s',
  async (scenario) => {
    const directory = await mkdtemp(join(tmpdir(), 'loom-content-header-'));
    try {
      const size = 2 * 1024 * 1024;
      const paths = ['a.txt', 'b.txt', 'c.txt', 'd.txt'].map((name) => join(directory, name));
      for (const path of paths) {
        await writeFile(path, 'x'.repeat(size));
      }
      const result = invoke(new URL('fixtures/content.mjs', import.meta.url), [scenario, ...paths]);
      expect(result.stderr).toBe('');
      expect(result.status).toBe(0);
      const lengths = JSON.parse(result.stdout);
      expect(lengths).toHaveLength(100);
      for (const reopened of lengths) {
        expect(reopened).toEqual([size, size, size, size]);
      }
    } finally {
      await rm(directory, { recursive: true });
    }
  },
);

test.each([
  '/dev/stdin',
  '/dev/fd/0',
  ...(process.platform === 'linux' ? ['/proc/self/fd/0'] : []),
])('a named content path cannot read process stdin through %s', (path) => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['named-pipe', path]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toMatchObject({
    outcome: {
      exitCode: 2,
      failure: {
        name: 'InputError',
        problems: [
          { issues: [{ message: 'Expected a readable file that exists.' }], reason: 'invalid' },
        ],
      },
      output: '',
      status: 'failed',
    },
    remaining: 'transport sentinel\n',
  });
});

test('a named content path cannot read process stdin through a symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-stdin-link-'));
  try {
    const path = join(directory, 'input');
    await symlink('/dev/stdin', path);
    const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['named-pipe', path]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(JSON.parse(result.stdout)).toMatchObject({
      outcome: { exitCode: 2, output: '', status: 'failed' },
      remaining: 'transport sentinel\n',
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('a named regular file opens independently when the same file is redirected to stdin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-redirected-'));
  try {
    const path = join(directory, 'input.txt');
    await writeFile(path, 'source sentinel\n');
    const result = invoke(new URL('fixtures/content.mjs', import.meta.url), [
      'named-redirected',
      path,
    ]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const { outcome, remaining } = JSON.parse(result.stdout);
    expect(outcome.status).toBe('completed');
    expect(JSON.parse(outcome.output)).toEqual({
      kind: 'file',
      name: path,
      path,
      text: 'source sentinel\n',
    });
    expect(remaining).toBe('source sentinel\n');
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('a named content input accepts an unrelated FIFO', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-fifo-'));
  try {
    const path = join(directory, 'input');
    const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['named-fifo', path]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    const { outcome } = JSON.parse(result.stdout);
    expect(outcome.status).toBe('completed');
    expect(JSON.parse(outcome.output)).toEqual({
      kind: 'file',
      name: path,
      path,
      text: 'source sentinel\n',
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('a named content input accepts an unrelated device', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), [
    'named-pipe',
    '/dev/null',
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const { outcome, remaining } = JSON.parse(result.stdout);
  expect(outcome.status).toBe('completed');
  expect(JSON.parse(outcome.output).text).toBe('');
  expect(remaining).toBe('transport sentinel\n');
});

test('closed process stdin leaves unrelated named sources usable', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), [
    'file-closed-stdin',
    '/dev/null',
  ]);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const outcome = JSON.parse(result.stdout);
  expect(outcome.status).toBe('completed');
  expect(JSON.parse(outcome.output).text).toBe('');
});

test('argv content paths can still name process stdin', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), [
    'argv-pipe',
    '/dev/stdin',
  ]);
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'transport sentinel\n\n' });
});

test('argv content paths accept process substitution', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['argv-substitution']);
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'source sentinel\n\n' });
});

test('a second stdin declaration on one Command is a declaration fault', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['duplicate']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toMatchObject({
    name: 'DeclarationError',
    rule: '@loomcli/core/stdin-claimed-twice',
  });
});

test('a stdin-only declaration hands the action a lazy stdin handle', () => {
  expect(
    invoke(new URL('fixtures/content.mjs', import.meta.url), ['stdin'], { input: 'events\n' }),
  ).toEqual({
    status: 0,
    stderr: '',
    stdout: 'events\n\n',
  });
});

test('missing stdin joins other missing inputs in one failure', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['stdin-missing']);
  expect(result.status).toBe(2);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Option "--name" is required.');
  expect(result.stderr).toContain('Stdin: Expected at least 1 readable source.');
});

test('stdin problems retain their declaration position among other input problems', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['stdin-order']);
  const outcome = JSON.parse(result.stdout);
  expect(outcome.status).toBe('failed');
  expect(outcome.failure).toEqual([
    {
      input: { global: false, kind: 'stdin', name: 'stdin' },
      reason: 'missing',
      spelling: 'stdin',
    },
    { input: { global: false, kind: 'option', name: 'name' }, reason: 'missing', spelling: 'name' },
  ]);
});

test('optional stdin help includes a pipeline example while keeping ordinary usage', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['stdin-help-optional']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('content [options]');
  expect(result.stdout).toContain('Optional.');
  expect(result.stdout).toContain('<producer> | content');
});

test('help describes stdin-only input without consuming it', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['stdin-help']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain('INPUT');
  expect(result.stdout).toContain('The event stream.');
  expect(result.stdout).toContain('Required.');
  expect(result.stdout).toContain('piped or redirected stdin');
});

test('repeated - entries read the same stdin at its current position', () => {
  const result = invoke(
    new URL('fixtures/content.mjs', import.meta.url),
    ['collection', '-', '-'],
    { input: 'one\n' },
  );
  expect(JSON.parse(result.stdout)).toEqual([
    { kind: 'stdin', name: 'stdin', text: 'one\n' },
    { kind: 'stdin', name: 'stdin', text: '' },
  ]);
  expect(result.status).toBe(0);
});

test('a scalar content option uses its supplied file and leaves piped stdin unread', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-'));
  try {
    await writeFile(join(directory, 'input.txt'), 'file');
    const result = invoke(
      new URL('fixtures/content.mjs', import.meta.url),
      ['scalar', '--file', 'input.txt'],
      { cwd: directory, input: 'pipe' },
    );
    expect(result).toEqual({ status: 0, stderr: '', stdout: 'file\n' });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('a collection maximum includes automatically appended stdin', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-'));
  try {
    const path = join(directory, 'input.txt');
    await writeFile(path, 'file');
    const result = invoke(
      new URL('fixtures/content.mjs', import.meta.url),
      ['collection-max', path],
      { input: 'pipe' },
    );
    expect(result.status).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Expected at most 1 readable source.');
  } finally {
    await rm(directory, { recursive: true });
  }
});

test.each(['named-empty', 'named-dash'])(
  'named content invocation rejects unavailable stdin: %s',
  (scenario) => {
    const result = invoke(new URL('fixtures/content.mjs', import.meta.url), [scenario]);
    expect(JSON.parse(result.stdout)).toMatchObject({ exitCode: 2, output: '', status: 'failed' });
  },
);

test('an explicit - at a terminal is an input error', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['terminal', '-']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('Expected piped or redirected stdin.');
});

test('content preparation leaves an open stdin unread when another input fails', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['unread']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('Option "--name" is required.');
  expect(result.stdout).toBe('{"reads":0}');
});

test('content reads .. after following a directory symlink', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-link-'));
  try {
    await mkdir(join(directory, 'real', 'child'), { recursive: true });
    await writeFile(join(directory, 'real', 'target.txt'), 'followed');
    await writeFile(join(directory, 'target.txt'), 'lexical');
    await symlink(join(directory, 'real', 'child'), join(directory, 'link'));
    const result = invoke(
      new URL('fixtures/content.mjs', import.meta.url),
      ['scalar', '--file', 'link/../target.txt'],
      { cwd: directory },
    );
    expect(result).toEqual({ status: 0, stderr: '', stdout: 'followed\n' });
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('a trailing slash cannot turn a file operand into another source', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-slash-'));
  try {
    await writeFile(join(directory, 'file.txt'), 'file');
    const result = invoke(
      new URL('fixtures/content.mjs', import.meta.url),
      ['scalar', '--file', 'file.txt/'],
      { cwd: directory },
    );
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('Expected a readable file that exists.');
    expect(result.stdout).toBe('');
  } finally {
    await rm(directory, { recursive: true });
  }
});

test('a group cannot declare a stdin input that no action receives', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['stdin-group']);
  expect(JSON.parse(result.stdout)).toMatchObject({
    name: 'DeclarationError',
    rule: '@loomcli/core/command-without-action',
  });
});

test.each([
  ['named-conflict', ['argument', 'option']],
  ['mixed-conflict', ['argument', 'stdin']],
])('stdin conflict findings name every actual declaration: %s', (scenario, calls) => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), [scenario]);
  const error = JSON.parse(result.stdout);
  expect(error.rule).toBe('@loomcli/core/stdin-claimed-twice');
  expect(error.findings).toHaveLength(2);
  expect(
    error.findings.every((finding: { path: string[] }) => finding.path.join('/') === 'cmd'),
  ).toBe(true);
  expect(error.findings.map((finding: { call: string }) => finding.call)).toEqual(calls);
});

test('stdin conflict findings identify the hook that declared a competing target', () => {
  const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['hook-conflict']);
  const error = JSON.parse(result.stdout);
  expect(error.rule).toBe('@loomcli/core/stdin-claimed-twice');
  expect(error.findings).toHaveLength(2);
  expect(error.findings[1]).toMatchObject({
    note: 'declared by plugin "@fixture/claim" in onCommandAttach; claims stdin',
    path: ['cmd'],
  });
});

test('a content collection appends piped stdin after the supplied files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'loom-content-'));
  try {
    const path = join(directory, 'input.txt');
    await writeFile(path, 'file\n');
    const result = invoke(new URL('fixtures/content.mjs', import.meta.url), ['collection', path], {
      input: 'pipe\n',
    });
    expect(result).toEqual({
      status: 0,
      stderr: '',
      stdout: `${JSON.stringify([
        { kind: 'file', name: path, text: 'file\n' },
        { kind: 'stdin', name: 'stdin', text: 'pipe\n' },
      ])}\n`,
    });
  } finally {
    await rm(directory, { recursive: true });
  }
});
