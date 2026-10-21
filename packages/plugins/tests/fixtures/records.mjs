import { Application } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';

const scenario = process.argv[2] ?? 'default';
const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';

const cases = {
  declared: {
    declared: true,
    rows: [{ key: 'user', kind: 'object' }],
    view: records({ identifier: 'key' }),
  },
  default: {
    rows: [
      { key: 'user', kind: 'object with 3 keys' },
      { key: 'tags', kind: 'array with 2 items' },
    ],
    view: records({ identifier: 'key' }),
  },
  empty: { rows: [], view: records({ identifier: 'key' }) },
  escape: {
    rows: [{ authored: marker, key: 'one', raw: marker }],
    view: records({
      fields: ['raw', { format: (value) => value, key: 'authored' }],
      identifier: 'key',
    }),
  },
  'escaped-key': {
    rows: [{ [marker]: 'value' }],
    view: records({ identifier: marker }),
  },
  explicit: {
    rows: [
      { key: 'user', kind: 'object' },
      { key: 'tags', kind: 'array' },
    ],
    view: records({ fields: ['kind', 'key'], identifier: 'key' }),
  },
  'identifier-omitted': {
    rows: [{ key: 'user', kind: 'object' }],
    view: records({ fields: ['kind'], identifier: 'key' }),
  },
  nullish: {
    rows: [{ key: 'one', missing: undefined, nullish: null }],
    view: records({ fields: ['nullish', 'missing', 'key'], identifier: 'key' }),
  },
  'row-width': {
    rows: [
      { longest: 'b', short: 'a' },
      { xx: 'c', yy: 'd' },
    ],
    view: records({ identifier: 'short' }),
  },
};

const selected = cases[scenario];
const app = selected.declared
  ? new Application('records')
      .rows({ views: { records: selected.view } })
      .action(({ out }) => out.results(selected.rows))
  : new Application('records').action(({ out }) => out.render(selected.rows, selected.view));

const code = await app.run({ host: { argv: [] } });
process.stdout.write(`resolved:${String(code)}\n`);
