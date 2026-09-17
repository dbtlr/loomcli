import type { CommandAttachHook } from '@loomcli/core';

import { formatName } from './names.js';
import { json, jsonl } from './views.js';

/**
 * Appends `json` and `jsonl` to a Command's result where its record lacks the key, then declares
 * `--format` over the resulting names. A Command with no result is returned unchanged.
 */
export const attachFormat: CommandAttachHook = (command) => {
  const result = command.result;
  if (result === null) {
    return command;
  }
  const machine = { json: json(), jsonl: jsonl() };
  const added = Object.entries(machine).filter(([name]) => !result.views.includes(name));
  const reshaped = command.views(Object.fromEntries(added));
  // `views()` appends a name the record lacks and leaves the place of one it holds.
  const names = [...result.views, ...added.map(([name]) => name)];
  return reshaped.option('format', {
    description: `Select the output format: ${names.join(', ')}. Default: ${result.default}.`,
    type: 'string',
    validate: formatName(names),
  });
};
