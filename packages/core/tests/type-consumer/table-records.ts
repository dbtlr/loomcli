import { Command } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

interface Row {
  count: number;
  source: string;
}

const valid = new Command('valid').rows<Row>({
  views: {
    records: records({
      fields: [
        {
          format: (value) => {
            const count: number = value;
            return String(count);
          },
          key: 'count',
        },
        'source',
      ],
      identifier: 'source',
    }),
    table: table({
      columns: [
        {
          format: (value) => {
            const count: number = value;
            return String(count);
          },
          key: 'count',
        },
        'source',
      ],
    }),
  },
});

new Command('wrong-column').rows<Row>({
  views: {
    // @ts-expect-error TS2322: A table column must name a key the row carries.
    table: table({ columns: ['missing'] }),
  },
});

new Command('wrong-field-shape').rows<Row>({
  views: {
    records: records({
      // @ts-expect-error TS2353: A records field has no header spelling.
      fields: [{ header: 'COUNT', key: 'count' }],
      identifier: 'source',
    }),
  },
});

new Command('wrong-identifier').rows<Row>({
  views: {
    // @ts-expect-error TS2322: A records identifier must name a key the row carries.
    records: records({ identifier: 'missing' }),
  },
});

new Command('wrong-format').rows<Row>({
  views: {
    table: table({
      columns: [
        {
          // @ts-expect-error TS2322: A formatter receives the value type of its own key.
          format: (value: string) => value,
          key: 'count',
        },
      ],
    }),
  },
});

// As the second argument of out.render, the type flows in from the data under each shape and source.
const rendered = new Command('rendered').action(async ({ out }) => {
  const array: readonly Row[] = [];
  function* generated(): Generator<Row> {
    yield* array;
  }
  async function* streamed(): AsyncGenerator<Row> {
    yield* array;
  }
  await out.render(
    array,
    table({ columns: ['source', { format: (value) => value.toFixed(1), key: 'count' }] }),
  );
  await out.render(
    generated(),
    records({
      fields: [{ format: (value) => value.toFixed(1), key: 'count' }],
      identifier: 'source',
    }),
  );
  await out.render(streamed(), records({ identifier: 'source' }));
  // @ts-expect-error TS2322: A table column must name a key the rows carry.
  await out.render(array, table({ columns: ['missing'] }));
  // @ts-expect-error TS2322: A records identifier must name a key the rows carry.
  await out.render(generated(), records({ identifier: 'missing' }));
  // @ts-expect-error TS2322: A records field must name a key the rows carry.
  await out.render(streamed(), records({ fields: ['missing'], identifier: 'source' }));
  await out.render(
    array,
    records({
      fields: [
        {
          // @ts-expect-error TS2322: A records formatter receives the value type of its own key.
          format: (value: string) => value,
          key: 'count',
        },
      ],
      identifier: 'source',
    }),
  );
  await out.render(
    generated(),
    records({
      fields: [
        {
          // @ts-expect-error TS2322: Over a generator the formatter receives the same value type.
          format: (value: string) => value,
          key: 'count',
        },
      ],
      identifier: 'source',
    }),
  );
  // @ts-expect-error TS2345: A whole view renders a value, so a generator needs a row view.
  await out.render(generated(), table());
});

void valid;
void rendered;
