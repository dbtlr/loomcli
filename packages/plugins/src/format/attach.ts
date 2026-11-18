import type { AttachedCommand, CommandAttachHook } from '@loomcli/core';

import { providedViews } from './extension.js';
import { fieldList, formatName } from './names.js';
import type { FormatSettings } from './plugin.js';
import { json, jsonl, jsonlRows } from './views.js';

/**
 * The names a group's `--format` accepts: the formatter's own views, whose media types its
 * middleware states at a group.
 */
const groupNames = ['json', 'jsonl'];

/** What `--fields` says on a help page. */
const fieldsDescription = 'Select top-level fields of json and jsonl output, as a comma list.';

/**
 * The `--fields` the hook declares beside `--format`: a control option, because it says how the run
 * prints, that may repeat, each value a comma list of field names. `hidden` hides it on a group, as
 * the group's `--format` is hidden.
 */
function withFields(command: AttachedCommand, hidden: boolean): AttachedCommand {
  return command.option('fields', {
    control: true,
    description: fieldsDescription,
    ...(hidden ? { hidden } : {}),
    multiple: true,
    type: 'string',
    validate: fieldList(),
  });
}

/**
 * The hidden `--format` a group takes. A group declares no result, so the option names the
 * formatter's two encodings alone, and its middleware states the media type the name's view
 * declares. It is hidden, because a bare group invocation always fails with the missing
 * subcommand, so no listing advertises it.
 */
function attachToGroup(command: AttachedCommand, short: FormatSettings['short']): AttachedCommand {
  const formatted = command.option('format', {
    control: true,
    description: 'Select the output format.',
    hidden: true,
    ...(short === undefined ? {} : { short }),
    type: 'string',
    validate: formatName(groupNames),
  });
  return withFields(formatted, true);
}

/**
 * The hook that appends `json` and `jsonl`, `jsonl` as a row view under a rows result, to a
 * Command's result where its record lacks the key, then declares `--format` over the resulting
 * names, with `short` as its short spelling or none when it is undefined, and `--fields`, and
 * that declares a hidden `--format` and `--fields` on a group. `format()` has already judged that
 * spelling at its call. A Command with an action and no result is returned unchanged.
 */
export function attachFormat(short: FormatSettings['short']): CommandAttachHook {
  return (command) => {
    const result = command.result;
    if (result === null) {
      return command.hasAction ? command : attachToGroup(command, short);
    }
    // Rows stream through a row view, so a jq-style pipeline reads each record as it arrives.
    const machine = {
      json: json(),
      jsonl: result.kind === 'rows' ? jsonlRows() : jsonl(),
    };
    const added = Object.entries(machine).filter(([name]) => !result.views.includes(name));
    const reshaped = command
      .views(Object.fromEntries(added))
      .extend(providedViews(added.map(([name]) => name)));
    // `views()` appends a name the record lacks and leaves the place of one it holds.
    const names = [...result.views, ...added.map(([name]) => name)];
    // `--format` says how the run prints, not what the Command works on, so it is a control option.
    const formatted = reshaped.option('format', {
      control: true,
      description: `Select the output format, ${result.default} by default.`,
      ...(short === undefined ? {} : { short }),
      type: 'string',
      validate: formatName(names),
    });
    return withFields(formatted, false);
  };
}
