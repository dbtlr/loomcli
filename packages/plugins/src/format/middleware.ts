import type { Middleware } from '@loomcli/core';

import type { format } from './plugin.js';

/** The media type each of the formatter's views declares, which a group's `--format` states. */
const encodings = new Map([
  ['json', 'application/json'],
  ['jsonl', 'application/jsonl'],
]);

/**
 * Copies a supplied `--format` into `view` on a Command that declares a result, and at a group
 * states the media type that name's view declares through `mediaType`. The option is
 * hook-declared, so its value is unknown to the types, and `ownOptions` holds it whenever it
 * validated, a held fault on another input included, so the selection stands for the failure too.
 */
const middleware: Middleware<typeof format> = async (context) => {
  // A hook-declared option, so its value is unknown to the types; it stands under a held fault.
  const selected = context.ownOptions.format;
  if (typeof selected === 'string') {
    const encoding = encodings.get(selected);
    if (context.view !== null) {
      context.view = selected;
    } else if (encoding !== undefined) {
      // Only a group holds the option where no view is, so this states the group's media type.
      context.mediaType = encoding;
    }
  }
  await context.next();
};

export default middleware;
