import type { FatalError, View, ViewContext } from '@loomcli/core';

import { totalRow } from './row.js';
import type { Row } from './row.js';

export const fatalError: View<FatalError> = {
  render: (failure, { style }) => `${style.escape(failure.message)}\n`,
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
