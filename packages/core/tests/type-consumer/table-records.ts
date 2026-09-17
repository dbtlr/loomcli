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

void valid;
