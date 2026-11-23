// @module-tag docs

// Acceptance plan: see packages/plugins/tests/installed-files.test.ts.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { recordInstallation } from '../../../scripts/test-installation.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A temporary home and state directory, and a fixture binary whose bytes are `test`. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-recipe-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  mkdirSync(home);
  mkdirSync(state);
  const bin = join(root, 'bin');
  mkdirSync(bin);
  const binary = join(bin, 'notes');
  writeFileSync(binary, 'test');
  return { bin, binary, home, root, state };
}

/** The recipe run for the notes application with the supplied environment. */
function install(target: string, env: Record<string, string>) {
  return recordInstallation('notes', target, env);
}

/** The SHA-256 digest of the four bytes `test`, as the contract's example records it. */
const testDigest = 'sha256:9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';

/** The record directory this platform's row names under the sandbox. */
function recordOf(box: { home: string; state: string }) {
  return process.platform === 'darwin'
    ? join(box.home, 'Library', 'Application Support', 'notes', 'installation')
    : join(box.state, 'notes', 'installation');
}

test('the recipe writes install.json with the pinned bytes', () => {
  const box = sandbox();
  const result = install(box.binary, { HOME: box.home, XDG_STATE_HOME: box.state });
  expect(result).toEqual({ status: 0, stderr: '', stdout: '' });
  expect(readFileSync(join(recordOf(box), 'install.json'), 'utf8')).toBe(
    `{"format":1,"method":"script","path":"${box.binary}","digest":"${testDigest}"}\n`,
  );
});

test('the recipe leaves no staging file beside install.json', () => {
  const box = sandbox();
  install(box.binary, { HOME: box.home, XDG_STATE_HOME: box.state });
  install(box.binary, { HOME: box.home, XDG_STATE_HOME: box.state });
  expect(readdirSync(recordOf(box))).toEqual(['install.json']);
});

test.each([
  ['a quote', 'no"tes'],
  ['a backslash', String.raw`no\tes`],
  ['a newline', 'no\ntes'],
])('a target path holding %s exits 1 and writes nothing', (_case, name) => {
  const box = sandbox();
  const target = join(box.bin, name);
  writeFileSync(target, 'test');
  const result = install(target, { HOME: box.home, XDG_STATE_HOME: box.state });
  expect(result).toEqual({
    status: 1,
    stderr:
      'notes: The install path holds a quote, a backslash, or a control character. Choose another install directory.\n',
    stdout: '',
  });
  expect(existsSync(join(box.state, 'notes'))).toBe(false);
  expect(existsSync(join(box.home, 'Library'))).toBe(false);
});

test('a relative target path exits 1 and writes nothing', () => {
  const box = sandbox();
  const result = install('bin/notes', { HOME: box.home, XDG_STATE_HOME: box.state });
  expect(result).toEqual({
    status: 1,
    stderr: 'notes: The install path is not absolute. Choose an absolute install directory.\n',
    stdout: '',
  });
  expect(existsSync(join(box.state, 'notes'))).toBe(false);
});

test('a relative HOME the directory needs exits 1 and writes nothing', () => {
  const box = sandbox();
  // XDG_STATE_HOME is unset, so the directory needs HOME on every platform.
  const result = install(box.binary, { HOME: 'home' });
  expect(result).toEqual({
    status: 1,
    stderr:
      'notes: HOME is not an absolute path. Set it to your home directory, then run the installer again.\n',
    stdout: '',
  });
  expect(existsSync(join(box.root, 'home', '.local'))).toBe(false);
});

test.skipIf(process.platform !== 'linux')(
  'on Linux, an absolute XDG_STATE_HOME writes install.json with HOME unset',
  () => {
    const box = sandbox();
    const result = install(box.binary, { XDG_STATE_HOME: box.state });
    expect(result).toEqual({ status: 0, stderr: '', stdout: '' });
    expect(readFileSync(join(box.state, 'notes', 'installation', 'install.json'), 'utf8')).toBe(
      `{"format":1,"method":"script","path":"${box.binary}","digest":"${testDigest}"}\n`,
    );
  },
);
