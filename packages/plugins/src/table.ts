import { pad } from '@loomcli/core';
import type { View, ViewContext } from '@loomcli/core';

import { splitMarkedLines } from './marked-lines.js';
import { recordBlock } from './record-block.js';
import { levelWidths, total } from './table-fit.js';

type TableAlignment = 'center' | 'left' | 'right';

const CENTER_SIDES = 2;
const EMPTY = 0;
const GAP = '  ';
const LAST_OFFSET = 1;
const NARROWEST = 1;

interface ColumnDefinition<Row, Key extends keyof Row & string> {
  readonly key: Key;
  readonly header?: string;
  readonly align?: TableAlignment;
  readonly format?: (value: Row[Key], row: Readonly<Row>, context: ViewContext) => string;
}

type ColumnEntry<Row> = {
  [Key in keyof Row & string]: ColumnDefinition<Row, Key>;
}[keyof Row & string];

type Column<Row> = (keyof Row & string) | ColumnEntry<Row>;

interface TableConfig<Row> {
  readonly columns?: readonly Column<Row>[];
}

/** One normalized column, including the typed path from a row to its rendered cell. */
interface PreparedColumn<Row> {
  readonly align: TableAlignment;
  readonly cell: (row: Readonly<Row>, context: ViewContext) => string;
  readonly header: (context: ViewContext) => string;
}

/** A data value escaped and styled by the view, with absence rendered as an empty cell. */
function defaultCell(value: unknown, context: ViewContext): string {
  // `String(value)` is the documented cell coercion, including Object's default spelling.
  // oxlint-disable-next-line typescript/no-base-to-string
  const text = value === null || value === undefined ? '' : String(value);
  return context.style.primary(context.style.escape(text));
}

/** One object-form column, kept generic so its key determines its formatter's value type. */
function prepareEntry<Row, Key extends keyof Row & string>(
  entry: ColumnDefinition<Row, Key>,
): PreparedColumn<Row> {
  return {
    align: entry.align ?? 'left',
    cell: (row, context) =>
      entry.format
        ? entry.format(row[entry.key], row, context)
        : defaultCell(row[entry.key], context),
    header: (context) =>
      entry.header === undefined ? context.style.escape(entry.key) : entry.header,
  };
}

/** One shorthand or object-form column normalized for repeated row rendering. */
function prepareColumn<Row>(column: Column<Row>): PreparedColumn<Row> {
  return typeof column === 'string'
    ? prepareEntry<Row, typeof column>({ key: column })
    : prepareEntry(column);
}

/** A column discovered from runtime row keys, which has no authored formatter. */
function prepareDiscoveredColumn<Row>(key: string): PreparedColumn<Row> {
  return {
    align: 'left',
    cell: (row, context) => defaultCell(Reflect.get(Object(row), key), context),
    header: (context) => context.style.escape(key),
  };
}

/** Every own enumerable key in first-seen order across all rows. */
function discoverColumns<Row>(rows: readonly Row[]): PreparedColumn<Row>[] {
  const seen = new Set<string>();
  const columns: PreparedColumn<Row>[] = [];
  for (const row of rows) {
    for (const key of Object.keys(Object(row))) {
      if (!seen.has(key)) {
        seen.add(key);
        columns.push(prepareDiscoveredColumn(key));
      }
    }
  }
  return columns;
}

/** One cell line padded to its column width without adding spaces after the last cell. */
function renderCell<Row>({
  column,
  context,
  last,
  text,
  width,
}: {
  column: PreparedColumn<Row>;
  context: ViewContext;
  last: boolean;
  text: string;
  width: number;
}): string {
  if (!last || column.align === 'right') {
    return pad(text, width, { align: column.align });
  }
  if (column.align === 'left') {
    return text;
  }
  const leading = Math.floor(Math.max(EMPTY, width - context.width(text)) / CENTER_SIDES);
  return `${pad('', leading)}${text}`;
}

/** The table as the layout reads it: each column with its header and cells as marked text. */
interface Grid<Row> {
  readonly cells: readonly (readonly string[])[];
  readonly columns: readonly PreparedColumn<Row>[];
  readonly context: ViewContext;
  readonly headers: readonly string[];
}

/** Each column's width when it is padded to the widest of its header and cells. */
function naturalWidths<Row>({ cells, context, headers }: Grid<Row>): number[] {
  return headers.map((header, index) => {
    let width = context.width(header);
    for (const row of cells) {
      width = Math.max(width, context.width(row[index] ?? ''));
    }
    return width;
  });
}

/**
 * Each column's floor: the widest unit `wrap` keeps whole in its header or any cell, read from
 * `wrap` itself at one column, so a line's leading and trailing spaces count as `wrap` counts them.
 */
function floorWidths<Row>(
  { cells, context, headers }: Grid<Row>,
  natural: readonly number[],
): number[] {
  const unit = (text: string): number => context.width(context.wrap(text, NARROWEST));
  return headers.map((header, index) => {
    let width = unit(header);
    for (const row of cells) {
      width = Math.max(width, unit(row[index] ?? ''));
    }
    return Math.min(width, natural[index] ?? width);
  });
}

/**
 * The column widths of a render, or undefined when the rows must print as record blocks. Off a
 * terminal, and on one the natural widths fit, each column is as wide as its widest text.
 * Otherwise the columns level down to their floors. When even the floors do not fit, a table with
 * rows falls back to records, and an empty one prints its header line at the floors.
 */
function fittedWidths<Row>(grid: Grid<Row>, rowCount: number): number[] | undefined {
  const natural = naturalWidths(grid);
  const target = grid.context.columns;
  const gaps = GAP.length * (natural.length - LAST_OFFSET);
  if (target === undefined || total(natural) + gaps <= target) {
    return natural;
  }
  const floors = floorWidths(grid, natural);
  if (total(floors) + gaps > target) {
    return rowCount === EMPTY ? floors : undefined;
  }
  return levelWidths(natural, floors, target - gaps);
}

/**
 * The lines of one cell. Off a terminal the cell is one unit, whatever its breaks. On a terminal
 * it wraps at its column's width, and each line is its own.
 */
function cellLines(text: string, context: ViewContext, width: number): string[] {
  return context.columns === undefined
    ? [text]
    : splitMarkedLines(context.wrap(text, Math.max(NARROWEST, width)));
}

/** One line of a row, from the cells that have a line at this height. */
function rowLine<Row>(
  cells: readonly (readonly string[])[],
  at: number,
  { columns, context, widths }: Pick<Grid<Row>, 'columns' | 'context'> & { widths: number[] },
): string {
  const pieces: string[] = [];
  for (const [index, column] of columns.entries()) {
    const last = index === columns.length - LAST_OFFSET;
    const own = cells[index] ?? [];
    if (!last || at < own.length) {
      const width = widths[index] ?? EMPTY;
      pieces.push(renderCell({ column, context, last, text: own[at] ?? '', width }));
    }
  }
  return pieces.join(GAP);
}

/**
 * One row of cells as lines, as tall as its tallest cell. A shorter cell adds blank lines padded
 * to its column, except a shorter last cell, whose added lines carry no padding and no gap.
 */
function rowLines<Row>(
  cells: readonly (readonly string[])[],
  layout: Pick<Grid<Row>, 'columns' | 'context'> & { widths: number[] },
): string[] {
  const height = Math.max(...cells.map((each) => each.length));
  return Array.from({ length: height }, (_unused, at) => rowLine(cells, at, layout));
}

/** The table as one line per cell line, with the header first, at the given column widths. */
function tableLines<Row>(grid: Grid<Row>, widths: number[]): string[] {
  const { cells, columns, context, headers } = grid;
  const header = headers.map((text, index) =>
    cellLines(text, context, widths[index] ?? EMPTY).map((line) => context.style.dim(line)),
  );
  const body = cells.map((row) =>
    row.map((text, index) => cellLines(text, context, widths[index] ?? EMPTY)),
  );
  return [header, ...body].flatMap((row) => rowLines(row, { columns, context, widths }));
}

/** The rows as record blocks, for a table whose columns cannot fit at their floors. */
function fallbackBlocks<Row>({ cells, columns, context, headers }: Grid<Row>): string {
  return cells
    .map((row) =>
      recordBlock(
        columns.map((column, index) => ({
          align: column.align,
          label: headers[index] ?? '',
          value: row[index] ?? '',
        })),
        context,
      ),
    )
    .join('\n');
}

/**
 * A whole view over rows, with columns measured before the first line is returned. The returned
 * value is a bare pack view and installs no plugin behavior.
 */
function table<Row>(config: TableConfig<Row> = {}): View<readonly Row[]> {
  const configured = config.columns?.map(prepareColumn<Row>);
  return {
    render: (rows, context) => {
      const columns = configured ?? discoverColumns(rows);
      if (columns.length === EMPTY) {
        return '';
      }
      const grid: Grid<Row> = {
        cells: rows.map((row) => columns.map((column) => column.cell(row, context))),
        columns,
        context,
        headers: columns.map((column) => column.header(context)),
      };
      const widths = fittedWidths(grid, rows.length);
      return widths === undefined
        ? fallbackBlocks(grid)
        : `${tableLines(grid, widths).join('\n')}\n`;
    },
  };
}

export { table };
export type { Column, ColumnEntry, TableConfig };
