import type { CommandAttachHook } from '@loomcli/core';

import { formatName } from './names.js';
import type { FormatSettings } from './plugin.js';
import { json, jsonl } from './views.js';

/**
 * The hook that appends `json` and `jsonl` to a Command's result where its record lacks the key,
 * then declares `--format` over the resulting names, with `short` as its short spelling or none
 * when it is undefined. `format()` has already judged that spelling at its call. A Command with no
 * result is returned unchanged.
 */
export function attachFormat(short: FormatSettings['short']): CommandAttachHook {
  return (command) => {
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
      description: `Select the output format, ${result.default} by default.`,
      ...(short === undefined ? {} : { short }),
      type: 'string',
      validate: formatName(names),
    });
  };
}
