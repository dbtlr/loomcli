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

/** Fixed absolute directories for lookups that never touch the disk. */
const fixed = { cache: '/cache', home: '/home/me', local: '/local', state: '/state' };

/** An empty temporary directory whose home, state, and cache directories the lookups name but never create. */
function sandbox() {
  const root = mkdtempSync(join(tmpdir(), 'loom-directory-'));
  roots.push(root);
  return {
    cache: join(root, 'cache'),
    home: join(root, 'home'),
    local: join(root, 'local'),
    root,
    state: join(root, 'state'),
  };
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
  ['linux', 'cache', ['cache', 'notes']],
  ['freebsd', 'installation', ['state', 'notes', 'installation']],
  ['darwin', 'installation', ['home', 'Library', 'Application Support', 'notes', 'installation']],
  ['darwin', 'logs', ['home', 'Library', 'Logs', 'notes']],
  ['darwin', 'cache', ['home', 'Library', 'Caches', 'notes']],
  ['win32', 'installation', ['local', 'notes', 'installation']],
  ['win32', 'logs', ['local', 'notes', 'Logs']],
  ['win32', 'cache', ['local', 'notes', 'Cache']],
] as const)('%s gives the %s row', (platform, kind, [base, ...segments]) => {
  const env = {
    HOME: fixed.home,
    LOCALAPPDATA: fixed.local,
    XDG_CACHE_HOME: fixed.cache,
    XDG_STATE_HOME: fixed.state,
  };
  expect(lookup(kind, platform, env)).toEqual({ path: join(fixed[base], ...segments) });
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'relative/state'],
])('an XDG_STATE_HOME that is %s falls back to HOME/.local/state', (_case, state) => {
  const env = { HOME: fixed.home, XDG_STATE_HOME: state };
  expect(lookup('installation', 'linux', env)).toEqual({
    path: join(fixed.home, '.local', 'state', 'notes', 'installation'),
  });
  expect(lookup('logs', 'linux', env)).toEqual({
    path: join(fixed.home, '.local', 'state', 'notes'),
  });
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'relative/cache'],
])('an XDG_CACHE_HOME that is %s falls back to HOME/.cache', (_case, cache) => {
  // The state directory never stands in for the cache, whatever it names.
  const env = { HOME: fixed.home, XDG_CACHE_HOME: cache, XDG_STATE_HOME: fixed.state };
  expect(lookup('cache', 'linux', env)).toEqual({ path: join(fixed.home, '.cache', 'notes') });
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'me'],
])('a HOME that is %s answers its variable wherever the row needs it', (_case, home) => {
  for (const kind of ['installation', 'logs', 'cache'] as const) {
    expect(lookup(kind, 'linux', { HOME: home })).toEqual({ variable: 'HOME' });
    expect(lookup(kind, 'darwin', { HOME: home, XDG_STATE_HOME: fixed.state })).toEqual({
      variable: 'HOME',
    });
  }
});

test('an absolute XDG_STATE_HOME or XDG_CACHE_HOME needs no HOME for its kinds', () => {
  expect(lookup('installation', 'linux', { XDG_STATE_HOME: fixed.state })).toEqual({
    path: join(fixed.state, 'notes', 'installation'),
  });
  expect(lookup('cache', 'linux', { XDG_CACHE_HOME: fixed.cache })).toEqual({
    path: join(fixed.cache, 'notes'),
  });
});

test.each([
  ['unset', undefined],
  ['empty', ''],
  ['relative', 'AppData'],
])('a LOCALAPPDATA that is %s answers its variable on win32', (_case, local) => {
  for (const kind of ['installation', 'logs', 'cache'] as const) {
    expect(lookup(kind, 'win32', { HOME: fixed.home, LOCALAPPDATA: local })).toEqual({
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
  const env = {
    HOME: box.home,
    LOCALAPPDATA: box.local,
    XDG_CACHE_HOME: box.cache,
    XDG_STATE_HOME: box.state,
  };
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const kind of ['installation', 'logs', 'cache'] as const) {
      lookup(kind, platform, env);
    }
  }
  expect(readdirSync(box.root)).toEqual([]);
  expect(existsSync(box.home)).toBe(false);
});
