import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { applicationDirectory } from '../src/index.js';
import type { ApplicationDirectory, DirectoryLookup } from '../src/index.js';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** An empty temporary directory whose home and state directories the lookups name but never create. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-directory-'));
  roots.push(root);
  return { home: join(root, 'home'), local: join(root, 'local'), root, state: join(root, 'state') };
}

/** One lookup of the notes application's directory from an overridden env and platform. */
function lookup(
  kind: ApplicationDirectory,
  platform: string,
  env: Record<string, string | undefined>,
): DirectoryLookup {
  return applicationDirectory(kind, 'notes', { env, platform });
}

test.each([
  ['linux', 'installation', ['state', 'notes', 'installation']],
  ['linux', 'logs', ['state', 'notes']],
  ['freebsd', 'installation', ['state', 'notes', 'installation']],
  ['darwin', 'installation', ['home', 'Library', 'Application Support', 'notes', 'installation']],
  ['darwin', 'logs', ['home', 'Library', 'Logs', 'notes']],
  ['win32', 'installation', ['local', 'notes', 'installation']],
  ['win32', 'logs', ['local', 'notes', 'Logs']],
] as const)('%s gives the %s row', (platform, kind, [base, ...segments]) => {
  const box = sandbox();
  const env = { HOME: box.home, LOCALAPPDATA: box.local, XDG_STATE_HOME: box.state };
  expect(lookup(kind, platform, env)).toEqual({ path: join(box[base], ...segments) });
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'relative/state'],
])('an XDG_STATE_HOME that is %s falls back to HOME/.local/state', (_case, state) => {
  const box = sandbox();
  const env = { HOME: box.home, XDG_STATE_HOME: state };
  expect(lookup('installation', 'linux', env)).toEqual({
    path: join(box.home, '.local', 'state', 'notes', 'installation'),
  });
  expect(lookup('logs', 'linux', env)).toEqual({
    path: join(box.home, '.local', 'state', 'notes'),
  });
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'me'],
])('a HOME that is %s answers its variable wherever the row needs it', (_case, home) => {
  for (const kind of ['installation', 'logs'] as const) {
    expect(lookup(kind, 'linux', { HOME: home })).toEqual({ variable: 'HOME' });
    expect(lookup(kind, 'darwin', { HOME: home, XDG_STATE_HOME: '/state' })).toEqual({
      variable: 'HOME',
    });
  }
});

test('an absolute XDG_STATE_HOME needs no HOME', () => {
  const box = sandbox();
  expect(lookup('installation', 'linux', { XDG_STATE_HOME: box.state })).toEqual({
    path: join(box.state, 'notes', 'installation'),
  });
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'AppData'],
])('a LOCALAPPDATA that is %s answers its variable on win32', (_case, local) => {
  for (const kind of ['installation', 'logs'] as const) {
    expect(lookup(kind, 'win32', { HOME: '/home/me', LOCALAPPDATA: local })).toEqual({
      variable: 'LOCALAPPDATA',
    });
  }
});

test.skipIf(process.platform === 'win32')(
  "the running process's path rules judge an absolute path, whatever the platform names",
  () => {
    expect(lookup('logs', 'win32', { LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local' })).toEqual({
      variable: 'LOCALAPPDATA',
    });
  },
);

test('a lookup reads no file and creates nothing', () => {
  const box = sandbox();
  const env = { HOME: box.home, LOCALAPPDATA: box.local, XDG_STATE_HOME: box.state };
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const kind of ['installation', 'logs'] as const) {
      lookup(kind, platform, env);
    }
  }
  expect(readdirSync(box.root)).toEqual([]);
  expect(existsSync(box.home)).toBe(false);
});
