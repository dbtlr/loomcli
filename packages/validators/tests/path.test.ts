import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
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
  'This validator reads the validation context, which only exists during a Loom run.';

const fixture = new URL('fixtures/path-run.mjs', import.meta.url);

/** Whether the process bypasses permission bits, so an unreadable entry would still read. */
const privileged = process.getuid?.() === 0;

/** One run of the fixture application with `--target` validated by `path(options)`. */
function run(options: object, cwd: string, token: string, platform: string = process.platform) {
  return invoke(fixture, [JSON.stringify(options), cwd, platform, `--target=${token}`]);
}

/** The run of an accepted token: the action prints the path the validator output. */
function accepted(resolved: string) {
  return { status: 0, stderr: '', stdout: `${JSON.stringify(resolved)}\n` };
}

/** The run of a rejected token: core reports the one sentence as invalid input. */
function refused(message: string) {
  return { status: 2, stderr: `Invalid input: Option "--target": ${message}\n`, stdout: '' };
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
])('path() accepts %j in a run and the token satisfies its published schema', (token) => {
  expect(run({}, '/loom/work', token, 'linux').status).toBe(0);
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
  await expect(rejection(path(), '')).resolves.toEqual(rejectedWith('Expected a path.'));
  await expect(rejection(path({ access: 'read' }), 'a\0b')).resolves.toEqual(
    rejectedWith('Expected a readable file that exists.'),
  );
});

describe('an option that can never work throws from the call', () => {
  const faults: [string, unknown, string][] = [
    [
      'options that are not an object',
      'read',
      'path() options is not a plain object. Supply an object or leave it out.',
    ],
    [
      'kind without access',
      { kind: 'file' },
      'path() kind has no access to check. Supply an access or leave out kind.',
    ],
    [
      'an access outside its set',
      { access: 'exec' },
      'path() access is not "read" or "write". Supply "read" or "write".',
    ],
    [
      'a kind outside its set',
      { access: 'read', kind: 'link' },
      'path() kind is not "file", "directory", or "any". Supply one of them.',
    ],
  ];

  it.each(faults)('%s', (_name, options, message) => {
    expect(faultOf(() => Reflect.apply(path, undefined, [options]))).toEqual(
      declarationFault(message),
    );
  });
});

describe('inside a run with no access', () => {
  it('a relative token resolves against the host cwd and normalizes', () => {
    expect(run({}, '/loom/work', 'a/../b/./c', 'linux')).toEqual(accepted('/loom/work/b/c'));
  });

  it('an absolute token keeps its own root', () => {
    expect(run({}, '/loom/work', '/etc//hosts', 'linux')).toEqual(accepted('/etc/hosts'));
  });

  it('the host platform chooses the path rules', () => {
    expect(run({}, String.raw`C:\work`, String.raw`a/b\c`, 'win32')).toEqual(
      accepted(String.raw`C:\work\a\b\c`),
    );
  });

  it('nothing on the filesystem is read', () => {
    expect(run({}, '/loom/missing', 'nowhere', 'linux')).toEqual(accepted('/loom/missing/nowhere'));
  });

  it('the empty string is rejected', () => {
    expect(run({}, '/loom/work', '')).toEqual(refused('Expected a path.'));
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

  it('read accepts a readable file, following a symbolic link', () => {
    expect(run({ access: 'read' }, root, 'a.txt')).toEqual(accepted(join(root, 'a.txt')));
    expect(run({ access: 'read', kind: 'file' }, root, 'link')).toEqual(
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
  ])('read of a file rejects %s', (_name, token) => {
    expect(run({ access: 'read' }, root, token)).toEqual(refused(readFile));
  });

  it.skipIf(privileged)('read rejects a file the process cannot read', () => {
    expect(run({ access: 'read' }, root, 'secret.txt')).toEqual(refused(readFile));
  });

  it('read of a directory accepts a directory and rejects a file', () => {
    expect(run({ access: 'read', kind: 'directory' }, root, 'sub')).toEqual(
      accepted(join(root, 'sub')),
    );
    expect(run({ access: 'read', kind: 'directory' }, root, 'a.txt')).toEqual(
      refused(readDirectory),
    );
  });

  it('read of any accepts a file and a directory and rejects a missing entry', () => {
    expect(run({ access: 'read', kind: 'any' }, root, 'a.txt')).toEqual(
      accepted(join(root, 'a.txt')),
    );
    expect(run({ access: 'read', kind: 'any' }, root, 'sub/')).toEqual(accepted(join(root, 'sub')));
    expect(run({ access: 'read', kind: 'any' }, root, 'missing')).toEqual(refused(readAny));
  });

  it('write accepts an existing file and a new file in a writable directory', () => {
    expect(run({ access: 'write' }, root, 'a.txt')).toEqual(accepted(join(root, 'a.txt')));
    expect(run({ access: 'write' }, root, 'new.txt')).toEqual(accepted(join(root, 'new.txt')));
    expect(run({ access: 'write' }, root, 'sub/new.txt')).toEqual(
      accepted(join(root, 'sub', 'new.txt')),
    );
  });

  it('write creates nothing', () => {
    expect(run({ access: 'write' }, root, 'created.txt')).toEqual(
      accepted(join(root, 'created.txt')),
    );
    expect(run({ access: 'read', kind: 'any' }, root, '.')).toEqual(accepted(root));
    expect(run({ access: 'read', kind: 'any' }, root, 'created.txt')).toEqual(refused(readAny));
  });

  it.each([
    ['a directory', 'sub'],
    ['a new file under a missing directory', 'missing/new.txt'],
    ['a new file under a file', 'a.txt/new.txt'],
  ])('write of a file rejects %s', (_name, token) => {
    expect(run({ access: 'write' }, root, token)).toEqual(refused(writeFile));
  });

  it.skipIf(privileged)('write rejects a read-only file and a locked directory', () => {
    expect(run({ access: 'write' }, root, 'readonly.txt')).toEqual(refused(writeFile));
    expect(run({ access: 'write' }, root, 'locked/new.txt')).toEqual(refused(writeFile));
  });

  it('write of a directory accepts an existing and a new directory and rejects a file', () => {
    expect(run({ access: 'write', kind: 'directory' }, root, 'sub')).toEqual(
      accepted(join(root, 'sub')),
    );
    expect(run({ access: 'write', kind: 'directory' }, root, 'fresh')).toEqual(
      accepted(join(root, 'fresh')),
    );
    expect(run({ access: 'write', kind: 'directory' }, root, 'a.txt')).toEqual(
      refused(writeDirectory),
    );
  });

  it('write of any accepts a file, a directory, and a new path', () => {
    expect(run({ access: 'write', kind: 'any' }, root, 'a.txt')).toEqual(
      accepted(join(root, 'a.txt')),
    );
    expect(run({ access: 'write', kind: 'any' }, root, 'sub')).toEqual(accepted(join(root, 'sub')));
    expect(run({ access: 'write', kind: 'any' }, root, 'fresh')).toEqual(
      accepted(join(root, 'fresh')),
    );
    expect(run({ access: 'write', kind: 'any' }, root, 'missing/fresh')).toEqual(refused(writeAny));
  });
});
