import type { FailureView, FatalError, ViewContext } from '@loomcli/core';

import { totalRow } from './row.js';
import type { Row } from './row.js';

/**
 * A `FatalError`'s message is marked text its author wrote, so the view prints the context's
 * `message` as it is: a plugin's `nowrap` frame resolves, and the sentence reads in the run's
 * language. Each site that puts an operator's value into the message escapes it there. The view
 * prints no hints, so a read failure reads as its one sentence, without the logging plugin's line.
 */
export const fatalError: FailureView<FatalError> = {
  render: (_failure, { message }) => `${message}\n`,
};

/** The summary marker cannot collide with a filename or enter JSON results. */
export function rowCell(
  value: number | string,
  row: Readonly<Row>,
  { style }: ViewContext,
): string {
  const token = row[totalRow] ? style.highlight : style.primary;
  return token(style.escape(String(value)));
}
