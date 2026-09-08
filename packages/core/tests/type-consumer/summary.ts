import type { ActionHandler } from '@loomcli/core';

import type { jsonkit } from './commands.js';

// The root action type-imports the composed application.
// Only the outermost call skips argument checking, so the chain registers the action last.
export const summary: ActionHandler<typeof jsonkit> = ({ options, out }) => {
  const file: string = options.file;
  const pretty: boolean = options.pretty;
  return out.print(`${file}:${String(pretty)}`);
};
