import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ReleaseFacts } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { runSelfUpdate } from './fixtures/self-update-mock.ts';

test('the update notice uses the script record when its path no longer resolves', async () => {
  const root = mkdtempSync(join(tmpdir(), 'loom-installation-notice-'));
  try {
    const cache = join(root, 'notes');
    mkdirSync(cache);
    const repository = 'acme/notes';
    writeFileSync(
      join(cache, 'update.json'),
      JSON.stringify({
        channel: 'stable',
        checked: new Date().toISOString(),
        format: 1,
        latest: '1.5.1',
        repository,
      }),
    );
    const release: ReleaseFacts = {
      build: 'distributed',
      installation: {
        digest: `sha256:${'a'.repeat(64)}`,
        method: 'script',
        path: join(root, 'removed', 'notes'),
      },
      release: { asset: 'notes-linux-x64', channel: 'stable', repository, version: '1.5.0' },
    };
    const result = await runSelfUpdate(
      {
        github: { feed: [], latest: null, releases: {}, repository },
        release,
        requests: join(root, 'requests.txt'),
        restyle: true,
      },
      {
        argv: ['add'],
        env: { HOME: root, XDG_CACHE_HOME: root },
        home: root,
        release,
        terminal: { columns: 120, rows: 24, streams: ['stdout', 'stderr'] },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stderr).toContain(
      '[info] notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.\n',
    );
  } finally {
    rmSync(root, { recursive: true });
  }
});
