import { readExtension } from '@loomcli/core';
import type { Middleware, MiddlewareContext } from '@loomcli/core';

import { providedViews } from './extension.js';
import { fieldsFailure, requestedFields, rowFields, spellingsOf, valueFields } from './fields.js';
import type { Spellings } from './fields.js';
import { formatPhrase } from './phrases.js';
import type { format } from './plugin.js';

/** The media type each of the formatter's views declares, which a group's `--format` states. */
const encodings = new Map([
  ['json', 'application/json'],
  ['jsonl', 'application/jsonl'],
]);

/** The length of a field list that names nothing. */
const EMPTY = 0;

/**
 * Fails the run when the selected view is not one of `appended`, the views the formatter appended,
 * naming them.
 */
function requireAppendedView(
  context: MiddlewareContext,
  appended: readonly string[],
  spellings: Spellings,
): void {
  if (!appended.includes(context.view ?? '')) {
    throw fieldsFailure(
      formatPhrase('fieldsNeedEncoding', spellings.fields, spellings.format, appended),
      spellings,
    );
  }
}

/**
 * Sets the run's result transform from a supplied `--fields`, which keeps the named fields, when
 * the selected view is one the formatter appended, and fails the run under any other view. It
 * acts only on a request core holds no fault for, so a held fault stays the one raised, and a
 * group, which renders no result, ignores it. A Command the formatter appended no view to has no
 * `--fields` of the formatter's, so an option of that name there is its author's and stays so.
 * Its failures name the options as the run supplied them: by spelling, or by declared name in an
 * invocation by name.
 */
function selectFields(context: MiddlewareContext): void {
  const fields = requestedFields(context.ownOptions.fields);
  if (fields.length === EMPTY || context.request === null) {
    return;
  }
  const result = context.command.result;
  const appended = readExtension(context.command, providedViews) ?? [];
  if (result === null || appended.length === EMPTY) {
    return;
  }
  const spellings = spellingsOf(context.invokedBy);
  requireAppendedView(context, appended, spellings);
  context.transform =
    result.kind === 'rows' ? rowFields(fields, spellings) : valueFields(fields, spellings);
}

/**
 * Copies a supplied `--format` into `view` on a Command that declares a result, and at a group
 * states the media type that name's view declares through `mediaType`. The option is
 * hook-declared, so its value is unknown to the types, and `ownOptions` holds it whenever it
 * validated, a held fault on another input included, so the selection stands for the failure too.
 * Then it sets the result transform `--fields` asks for, once the view is selected.
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
  selectFields(context);
  await context.next();
};

export default middleware;
