import { plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

// An always-on wrapper declares no options, so its middleware reads the erased options record.
export function timer(): Plugin {
  return plugin('@fixture/timer', {
    middleware: { activate: 'always', load: () => import('./plugin-timing.js') },
  });
}
