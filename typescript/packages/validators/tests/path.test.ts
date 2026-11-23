// Acceptance plan: see packages/validators/tests/catalog.test.ts.

import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, validationOptions } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { afterAll, beforeAll, describe, expect, it, test } from 'vite-plus/test';

import { path } from '../src/index.js';
import {
  conforms,
  declarationFault,
  faultOf,
  published,
  rejectedWith,
  rejection,
} from './support.js';

const dialect = 'https://json-schema.org/draft/2020-12/schema';

const outsideRun =
  'This validator reads the validation context, which only exists during a Loom run. Call the validator through an Application run or with the options validationOptions builds, or leave the context unread.';

/** Whether the process bypasses permission bits, so an unreadable entry would still read. */
const privileged = process.getuid?.() === 0;

/** What one validation of `token` by `path(options)` answered over a mock whose cwd is `cwd`. */
async function validate(
  options: object,
  cwd: string,
  token: string,
  platform: NodeJS.Platform = process.platform,
) {
  const result = await path(options)['~standard'].validate(
    token,
    validationOptions(mockProcess({ cwd, platform }), {
      input: { global: false, kind: 'option', name: 'target' },
      phase: 'invocation',
    }),
  );
  return result.issues === undefined
    ? { value: result.value }
    : { messages: result.issues.map((issue) => issue.message) };
}

/** The validation of an accepted token: the validator output the resolved path. */
function accepted(resolved: string) {
  return { value: resolved };
}

/** The validation of a rejected token: the one sentence the validator reports. */
function refused(message: string) {
  return { messages: [message] };
}

test('path() publishes a nonempty string and nothing about the filesystem', () => {
  expect(published(path())).toEqual({ $schema: dialect, minLength: 1, type: 'string' });
  expect(published(path({ access: 'read', kind: 'directory' }))).toEqual({
    $schema: dialect,
    minLength: 1,
    type: 'string',
  });
});

// The value a path token stands for is the token itself, so each accepted token meets the schema.
test.each([
  'a',
  '.',
  '/',
  'a/../b/./c',
  '/etc//hosts',
  String.raw`C:\work\a`,
  'dir/',
  '\u{1F600}.txt',
  ' ',
])('path() accepts %j in a run and the token satisfies its published schema', async (token) => {
  await expect(validate({}, '/loom/work', token, 'linux')).resolves.toHaveProperty('value');
  expect(conforms(path(), token)).toBe(true);
});

test('path() called directly throws the context sentence', () => {
  expect(faultOf(() => path()['~standard'].validate('notes.txt'))).toEqual(
    declarationFault(outsideRun),
  );
  expect(faultOf(() => path({ access: 'read' })['~standard'].validate('notes.txt'))).toEqual(
    declarationFault(outsideRun),
  );
});

test('the empty string and a NUL character are rejected before anything is read', async () => {
  await expect(rejection(path(), '')).resolves.toEqual(
    rejectedWith('Expected a nonempty path with no NUL character.'),
  );
  await expect(rejection(path({ access: 'read' }), 'a\0b')).resolves.toEqual(
    rejectedWith('Expected a readable file that exists.'),
  );
});

test('a kind without an access is a type error, because kind narrows the access check', () => {
  // @ts-expect-error TS2322: kind narrows the access check, so it is declared beside an access.
  const validator = path({ kind: 'file' });
  expect(published(validator)).toEqual({ $schema: dialect, minLength: 1, type: 'string' });
});

describe('inside a run with no access', () => {
  it('a relative token resolves against the host cwd and normalizes', async () => {
    await expect(validate({}, '/loom/work', 'a/../b/./c', 'linux')).resolves.toEqual(
      accepted('/loom/work/b/c'),
    );
  });

  it('an absolute token keeps its own root', async () => {
    await expect(validate({}, '/loom/work', '/etc//hosts', 'linux')).resolves.toEqual(
      accepted('/etc/hosts'),
    );
  });

  it('nothing on the filesystem is read', async () => {
    await expect(validate({}, '/loom/missing', 'nowhere', 'linux')).resolves.toEqual(
      accepted('/loom/missing/nowhere'),
    );
  });

  it('the empty string is rejected', async () => {
    await expect(validate({}, '/loom/work', '')).resolves.toEqual(
      refused('Expected a nonempty path with no NUL character.'),
    );
  });

  it('a run reports a rejected path as invalid input, with the sentence', async () => {
    const mock = mockProcess({ argv: ['--target='], cwd: '/loom/work', platform: 'linux' });
    const app = new Application('probe')
      .option('target', { type: 'string', validate: path() })
      .action(({ options, out }) => out.print(JSON.stringify(options.target)));
    await expect(app.run({ process: mock })).resolves.toBe(2);
    expect(mock.stdout.text).toBe('');
    expect(mock.stderr.text).toBe(
      'probe: Option "--target": Expected a nonempty path with no NUL character.\n',
    );
  });
});

describe('inside a run with access', () => {
  let root = '';

  beforeAll(() => {
    root = mkdtempSync(join(tmpdir(), 'loom-validators-'));
    writeFileSync(join(root, 'a.txt'), 'a');
    mkdirSync(join(root, 'sub'));
    writeFileSync(join(root, 'secret.txt'), 's');
    chmodSync(join(root, 'secret.txt'), 0o000);
    writeFileSync(join(root, 'readonly.txt'), 'r');
    chmodSync(join(root, 'readonly.txt'), 0o444);
    mkdirSync(join(root, 'locked'));
    chmodSync(join(root, 'locked'), 0o555);
    symlinkSync(join(root, 'a.txt'), join(root, 'link'));
    symlinkSync(join(root, 'missing'), join(root, 'dangling'));
    symlinkSync(join(root, 'loop'), join(root, 'loop'));
  });

  afterAll(() => {
    chmodSync(join(root, 'locked'), 0o755);
    chmodSync(join(root, 'secret.txt'), 0o644);
    rmSync(root, { force: true, recursive: true });
  });

  const readFile = 'Expected a readable file that exists.';
  const readDirectory = 'Expected a readable directory that exists.';
  const readAny = 'Expected a readable file or directory that exists.';
  const writeFile = 'Expected a writable file, or a new file in a writable directory.';
  const writeDirectory =
    'Expected a writable directory, or a new directory in a writable directory.';
  const writeAny = 'Expected a writable path, or a new path in a writable directory.';

  it('a test calls it alone with the options validationOptions builds over a mock', async () => {
    const options = validationOptions(mockProcess({ cwd: root }), {
      input: { global: false, kind: 'option', name: 'target' },
      phase: 'invocation',
    });
    const validator = path({ access: 'read' })['~standard'];
    const found = await validator.validate('a.txt', options);
    expect(found).toEqual({ value: join(root, 'a.txt') });
    const missing = await validator.validate('missing', options);
    expect(missing.issues?.map((issue) => issue.message)).toEqual([readFile]);
  });

  it('read accepts a readable file, following a symbolic link', async () => {
    await expect(validate({ access: 'read' }, root, 'a.txt')).resolves.toEqual(
      accepted(join(root, 'a.txt')),
    );
    await expect(validate({ access: 'read', kind: 'file' }, root, 'link')).resolves.toEqual(
      accepted(join(root, 'link')),
    );
  });

  it.each([
    ['a directory', 'sub'],
    ['a missing entry', 'missing'],
    ['a path through a file', 'a.txt/inner'],
    ['a dangling link', 'dangling'],
    ['a link loop', 'loop'],
    ['a name too long', 'n'.repeat(300)],
  ])('read of a file rejects %s', async (_name, token) => {
    await expect(validate({ access: 'read' }, root, token)).resolves.toEqual(refused(readFile));
  });

  it.skipIf(privileged)('read rejects a file the process cannot read', async () => {
    await expect(validate({ access: 'read' }, root, 'secret.txt')).resolves.toEqual(
      refused(readFile),
    );
  });

  it('read of a directory accepts a directory and rejects a file', async () => {
    await expect(validate({ access: 'read', kind: 'directory' }, root, 'sub')).resolves.toEqual(
      accepted(join(root, 'sub')),
    );
    await expect(validate({ access: 'read', kind: 'directory' }, root, 'a.txt')).resolves.toEqual(
      refused(readDirectory),
    );
  });

  it('read of any accepts a file and a directory and rejects a missing entry', async () => {
    await expect(validate({ access: 'read', kind: 'any' }, root, 'a.txt')).resolves.toEqual(
      accepted(join(root, 'a.txt')),
    );
    await expect(validate({ access: 'read', kind: 'any' }, root, 'sub/')).resolves.toEqual(
      accepted(join(root, 'sub')),
    );
    await expect(validate({ access: 'read', kind: 'any' }, root, 'missing')).resolves.toEqual(
      refused(readAny),
    );
  });

  it('write accepts an existing file and a new file in a writable directory', async () => {
    await expect(validate({ access: 'write' }, root, 'a.txt')).resolves.toEqual(
      accepted(join(root, 'a.txt')),
    );
    await expect(validate({ access: 'write' }, root, 'new.txt')).resolves.toEqual(
      accepted(join(root, 'new.txt')),
    );
    await expect(validate({ access: 'write' }, root, 'sub/new.txt')).resolves.toEqual(
      accepted(join(root, 'sub', 'new.txt')),
    );
  });

  it('write creates nothing', async () => {
    await expect(validate({ access: 'write' }, root, 'created.txt')).resolves.toEqual(
      accepted(join(root, 'created.txt')),
    );
    await expect(validate({ access: 'read', kind: 'any' }, root, '.')).resolves.toEqual(
      accepted(root),
    );
    await expect(validate({ access: 'read', kind: 'any' }, root, 'created.txt')).resolves.toEqual(
      refused(readAny),
    );
  });

  it.each([
    ['a directory', 'sub'],
    ['a new file under a missing directory', 'missing/new.txt'],
    ['a new file under a file', 'a.txt/new.txt'],
  ])('write of a file rejects %s', async (_name, token) => {
    await expect(validate({ access: 'write' }, root, token)).resolves.toEqual(refused(writeFile));
  });

  it.skipIf(privileged)('write rejects a read-only file and a locked directory', async () => {
    await expect(validate({ access: 'write' }, root, 'readonly.txt')).resolves.toEqual(
      refused(writeFile),
    );
    await expect(validate({ access: 'write' }, root, 'locked/new.txt')).resolves.toEqual(
      refused(writeFile),
    );
  });

  it('write of a directory accepts an existing and a new directory and rejects a file', async () => {
    await expect(validate({ access: 'write', kind: 'directory' }, root, 'sub')).resolves.toEqual(
      accepted(join(root, 'sub')),
    );
    await expect(validate({ access: 'write', kind: 'directory' }, root, 'fresh')).resolves.toEqual(
      accepted(join(root, 'fresh')),
    );
    await expect(validate({ access: 'write', kind: 'directory' }, root, 'a.txt')).resolves.toEqual(
      refused(writeDirectory),
    );
  });

  it('write of any accepts a file, a directory, and a new path', async () => {
    await expect(validate({ access: 'write', kind: 'any' }, root, 'a.txt')).resolves.toEqual(
      accepted(join(root, 'a.txt')),
    );
    await expect(validate({ access: 'write', kind: 'any' }, root, 'sub')).resolves.toEqual(
      accepted(join(root, 'sub')),
    );
    await expect(validate({ access: 'write', kind: 'any' }, root, 'fresh')).resolves.toEqual(
      accepted(join(root, 'fresh')),
    );
    await expect(
      validate({ access: 'write', kind: 'any' }, root, 'missing/fresh'),
    ).resolves.toEqual(refused(writeAny));
  });
});
