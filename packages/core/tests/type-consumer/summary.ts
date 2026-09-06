import type { ActionHandler } from '@loom/core';

import type { jsonkit } from './commands.js';

// The root action type-imports the composed application. The chain registers
// The action last, because only the outermost call skips argument checking.
export const summary: ActionHandler<typeof jsonkit> = ({ options, out }) => {
  const file: string = options.file;
  const pretty: boolean = options.pretty;
  return out.print(`${file}:${String(pretty)}`);
};
