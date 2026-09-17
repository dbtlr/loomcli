import { Application } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';

const scenario = process.argv[2] ?? 'explicit';

const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';

const cases = {
  declared: {
    declared: true,
    rows: [{ count: 3, source: 'declared.txt' }],
    view: table({ columns: ['source', 'count'] }),
  },
  defaults: {
    rows: [
      Object.fromEntries([
        ['source', 'one.txt'],
        ['count', 6],
      ]),
      Object.fromEntries([
        ['source', 'two words.txt'],
        ['extra', 'yes'],
        ['count', 2],
      ]),
    ],
    view: table(),
  },
  'duplicate-key': {
    rows: [{ count: 2 }],
    view: table({
      columns: [
        { header: 'COUNT', key: 'count' },
        { format: (value) => String(value * 10), header: 'TENS', key: 'count' },
      ],
    }),
  },
  'empty-default': { rows: [], view: table() },
  'empty-explicit': { rows: [], view: table({ columns: ['source', 'count'] }) },
  escape: {
    rows: [{ authored: marker, raw: marker }],
    view: table({ columns: ['raw', { format: (value) => value, key: 'authored' }] }),
  },
  explicit: {
    rows: [
      { count: 6, source: 'one.txt' },
      { count: 2, source: 'two words.txt' },
    ],
    view: table({
      columns: [{ align: 'right', header: 'COUNT', key: 'count' }, 'source'],
    }),
  },
  nullish: {
    rows: [{ end: 'x', missing: undefined, nullish: null }],
    view: table({ columns: ['nullish', 'missing', 'end'] }),
  },
  'styled-wide': {
    rows: [
      { count: 1, label: '猫猫' },
      { count: 20, label: 'styled' },
    ],
    view: table({
      columns: [
        { format: (value, _row, { style }) => style.red(value), header: 'N', key: 'label' },
        { align: 'right', key: 'count' },
      ],
    }),
  },
};

const selected = cases[scenario];

const app = selected.declared
  ? new Application('table')
      .rows({ views: { table: selected.view } })
      .action(({ out }) => out.results(selected.rows))
  : new Application('table').action(({ out }) => out.render(selected.rows, selected.view));

const code = await app.run({ host: { argv: [] } });
process.stdout.write(`resolved:${String(code)}\n`);
