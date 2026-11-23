/** Marks the summary row without adding a field to JSON results. */
export const totalRow = Symbol('totalRow');

/** One counted source: the number its metric produced, and the name the row prints. */
export interface Row {
  readonly [totalRow]?: true;
  count: number;
  source: string;
}
