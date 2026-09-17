import { pad } from '@loomcli/core';
import type { View, ViewContext } from '@loomcli/core';

type TableAlignment = 'center' | 'left' | 'right';

const EMPTY = 0;
const LAST_OFFSET = 1;

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

/** One line with two spaces between cells and no trailing padding on its last cell. */
function line<Row>(
  cells: readonly string[],
  columns: readonly PreparedColumn<Row>[],
  widths: readonly number[],
): string {
  return cells
    .map((cell, index) => {
      const column = columns[index];
      const width = widths[index];
      if (
        !column ||
        width === undefined ||
        (index === cells.length - LAST_OFFSET && column.align !== 'right')
      ) {
        return cell;
      }
      return pad(cell, width, { align: column.align });
    })
    .join('  ');
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
      const headers = columns.map((column) => context.style.dim(column.header(context)));
      const rendered = rows.map((row) => columns.map((column) => column.cell(row, context)));
      const widths = headers.map((header, index) => {
        let width = context.width(header);
        for (const cells of rendered) {
          width = Math.max(width, context.width(cells[index] ?? ''));
        }
        return width;
      });
      const lines = [
        line(headers, columns, widths),
        ...rendered.map((cells) => line(cells, columns, widths)),
      ];
      return `${lines.join('\n')}\n`;
    },
  };
}

export { table };
export type { Column, ColumnEntry, TableConfig };
