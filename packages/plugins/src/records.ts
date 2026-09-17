import { pad } from '@loomcli/core';
import type { RowView, ViewContext } from '@loomcli/core';

interface FieldDefinition<Row, Key extends keyof Row & string> {
  readonly key: Key;
  readonly format?: (value: Row[Key], row: Readonly<Row>, context: ViewContext) => string;
}

type FieldEntry<Row> = {
  [Key in keyof Row & string]: FieldDefinition<Row, Key>;
}[keyof Row & string];

type Field<Row> = (keyof Row & string) | FieldEntry<Row>;

interface RecordsConfig<Row> {
  readonly identifier: keyof Row & string;
  readonly fields?: readonly Field<Row>[];
}

const EMPTY = 0;
const FIRST = 0;
const SINGULAR = 1;

/** One normalized field, including the typed path from a row to its rendered value. */
interface PreparedField<Row> {
  readonly key: string;
  readonly value: (row: Readonly<Row>, context: ViewContext) => string;
}

/** A data value escaped and styled by the view, with absence rendered as an empty value. */
function defaultValue(value: unknown, identifier: boolean, context: ViewContext): string {
  // `String(value)` is the documented cell coercion, including Object's default spelling.
  // oxlint-disable-next-line typescript/no-base-to-string
  const text = value === null || value === undefined ? '' : String(value);
  const escaped = context.style.escape(text);
  return identifier ? context.style.highlight(escaped) : context.style.primary(escaped);
}

/** One object-form field, kept generic so its key determines its formatter's value type. */
function prepareEntry<Row, Key extends keyof Row & string>(
  entry: FieldDefinition<Row, Key>,
  identifier: keyof Row & string,
): PreparedField<Row> {
  return {
    key: entry.key,
    value: (row, context) =>
      entry.format
        ? entry.format(row[entry.key], row, context)
        : defaultValue(row[entry.key], entry.key === identifier, context),
  };
}

/** One shorthand or object-form field normalized for repeated row rendering. */
function prepareField<Row>(field: Field<Row>, identifier: keyof Row & string): PreparedField<Row> {
  return typeof field === 'string'
    ? prepareEntry<Row, typeof field>({ key: field }, identifier)
    : prepareEntry(field, identifier);
}

/** One field discovered from a runtime row key, which has no authored formatter. */
function prepareDiscoveredField<Row>(key: string, identifier: string): PreparedField<Row> {
  return {
    key,
    value: (row, context) =>
      defaultValue(Reflect.get(Object(row), key), key === identifier, context),
  };
}

/** Every own enumerable key of one row, in its property order. */
function discoverFields<Row>(row: Readonly<Row>, identifier: string): PreparedField<Row>[] {
  return Object.keys(Object(row)).map((key) => prepareDiscoveredField(key, identifier));
}

/** One record, with its key lane sized from either the declared fields or this row's own keys. */
function renderRecord<Row>({
  context,
  fields,
  index,
  row,
}: {
  context: ViewContext;
  fields: readonly PreparedField<Row>[];
  index: number;
  row: Readonly<Row>;
}): string {
  const keys = fields.map((field) => context.style.escape(field.key));
  let width = EMPTY;
  for (const key of keys) {
    width = Math.max(width, context.width(key));
  }
  const lines = fields.map((field, fieldIndex) => {
    const escapedKey = keys[fieldIndex] ?? context.style.escape(field.key);
    const key = context.style.dim(pad(escapedKey, width));
    return `${key}  ${field.value(row, context)}`;
  });
  const record = lines.length === EMPTY ? '' : `${lines.join('\n')}\n`;
  return index === FIRST ? record : `\n${record}`;
}

/**
 * A row view over records, with one key-value lane per field and a counted closing summary. The
 * returned value is a bare pack view and installs no plugin behavior.
 */
function records<Row>(config: RecordsConfig<Row>): RowView<Row> {
  const configured = config.fields?.map((field) => prepareField(field, config.identifier));
  return {
    row: (row, index, context) =>
      renderRecord({
        context,
        fields: configured ?? discoverFields(row, config.identifier),
        index,
        row,
      }),
    tail: (count, context) => {
      const summary = context.style.dim(
        `${String(count)} ${count === SINGULAR ? 'record' : 'records'}`,
      );
      return `${count === EMPTY ? '' : '\n'}${summary}\n`;
    },
  };
}

export { records };
export type { Field, FieldEntry, RecordsConfig };
