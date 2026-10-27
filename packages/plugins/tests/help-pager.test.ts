/*
 * The pager's shutdown handler (docs/plugins/help.md#help-paging), with typed stand-ins for the
 * spawn and the shutdown lane: while the pager is open help holds one handler that sends it SIGTERM,
 * and it removes the handler once the pager exits.
 */
import type { ChildExit, OnShutdown } from '@loomcli/core';
import { expect, test } from 'vite-plus/test';

import { showInPager } from '../src/help/pager.js';

const empty = { bytes: new Uint8Array(), text: '' };

test('while the pager is open, help holds one shutdown handler that sends it SIGTERM, removed once it exits', async () => {
  const handlers: (() => void)[] = [];
  let removed = 0;
  const onShutdown: OnShutdown = (handler) => {
    handlers.push(() => {
      handler({ cause: 'SIGINT', code: 130 });
    });
    return () => {
      removed += 1;
    };
  };
  const kills: string[] = [];
  const { promise: exited, resolve: exit } = Promise.withResolvers<ChildExit>();
  const host = {
    env: {},
    spawn: () => ({
      exited,
      kill: (signal = 'SIGTERM') => {
        kills.push(signal);
      },
    }),
  };
  const shown = showInPager(
    { host, onShutdown, signal: new AbortController().signal },
    'less',
    'page\n',
  );
  expect(handlers).toHaveLength(1);
  handlers[0]?.();
  expect(kills).toEqual(['SIGTERM']);
  expect(removed).toBe(0);
  exit({ code: 143, kind: 'exited', stderr: empty, stdout: empty });
  await expect(shown).resolves.toBe(true);
  expect(removed).toBe(1);
});
