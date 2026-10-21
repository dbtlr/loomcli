// Acceptance plan: see packages/plugins/tests/manpage.test.ts.

import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const updateFixture = new URL('fixtures/self-update-run.mjs', import.meta.url);
const manpageFixture = new URL('fixtures/manpage-run.mjs', import.meta.url);

const asset = 'notes-linux-x64';
const oldBytes = 'notes 1.4.2 binary\n';

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

function digestOf(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

test('an update rewrites a recorded page to the replaced binary’s version', () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-manpage-update-'));
  roots.push(root);
  const home = join(root, 'home');
  const state = join(root, 'state');
  const bin = join(root, 'bin');
  for (const directory of [home, state, bin, join(state, 'notes', 'installation')]) {
    mkdirSync(directory, { recursive: true });
  }
  const binary = join(bin, 'notes');
  writeFileSync(binary, oldBytes);
  chmodSync(binary, 0o755);
  writeFileSync(
    join(state, 'notes', 'installation', 'install.json'),
    `{"format":1,"method":"script","path":${JSON.stringify(binary)},"digest":"sha256:${digestOf(oldBytes)}"}\n`,
  );
  const env = {
    HOME: home,
    PATH: `${join(home, '.local', 'bin')}:/usr/bin`,
    XDG_STATE_HOME: state,
  };
  // The old version installed its pages.
  const oldScenario = join(root, 'old-scenario.json');
  writeFileSync(oldScenario, JSON.stringify({ cwd: root, env, version: '1.4.2' }));
  expect(
    invoke(manpageFixture, ['manpage', 'install'], { env: { MANPAGE_SCENARIO: oldScenario } })
      .status,
  ).toBe(0);
  const page = join(home, '.local', 'share', 'man', 'man1', 'notes.1');
  expect(readFileSync(page, 'utf8').split('\n')[0]).toBe('.TH "NOTES" "1" "" "notes 1.4.2" ""');
  // The new binary runs the same application at the new version.
  const newScenario = join(root, 'new-scenario.json');
  writeFileSync(newScenario, JSON.stringify({ cwd: root, env, version: '1.5.0' }));
  const bytes = `#!${process.execPath}\nimport(${JSON.stringify(fileURLToPath(manpageFixture))});\n`;
  const file = join(root, 'scenario.json');
  writeFileSync(
    file,
    JSON.stringify({
      env: { ...env, MANPAGE_SCENARIO: newScenario },
      github: {
        feed: ['v1.5.0'],
        latest: 'v1.5.0',
        releases: {
          'v1.5.0': { assets: { [asset]: bytes }, sums: `${digestOf(bytes)}  ${asset}\n` },
        },
        repository: 'acme/notes',
      },
      hook: 'refresh-manpages',
      release: {
        build: 'distributed',
        installation: { digest: `sha256:${digestOf(oldBytes)}`, method: 'script', path: binary },
        release: { asset, channel: 'stable', repository: 'acme/notes', version: '1.4.2' },
      },
      requests: join(root, 'requests.txt'),
    }),
  );
  const result = invoke(updateFixture, [file, 'self-update']);
  expect(result.status).toBe(0);
  expect(result.stderr).toContain('Updated notes from 1.4.2 to 1.5.0.');
  expect(result.stderr).toContain(
    `Updated 8 man pages in ${join(home, '.local', 'share', 'man', 'man1')}.`,
  );
  expect(readFileSync(page, 'utf8').split('\n')[0]).toBe('.TH "NOTES" "1" "" "notes 1.5.0" ""');
});
