import { Writable } from 'node:stream';

import { Application } from '@loomcli/core';
import type { RowView, View } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';

import { runOnMock } from './in-process.ts';

/** Runs the fixture on isolated process facts and returns its recorded output. */
type Row = Record<string, unknown>;

async function run(args: string[] = []) {
  const scenario = args[0] ?? 'explicit';

  const marker = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';

  const cases: Record<
    string,
    {
      declared?: boolean;
      discardOutput?: boolean;
      rows: readonly Row[];
      view: View<readonly Row[]> | RowView<Row>;
    }
  > = {
    declared: {
      declared: true,
      rows: [{ count: 3, source: 'declared.txt' }],
      view: table<Row>({ columns: ['source', 'count'] }),
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
      view: table<Row>(),
    },
    'duplicate-key': {
      rows: [{ count: 2 }],
      view: table<Row>({
        columns: [
          { header: 'COUNT', key: 'count' },
          { format: (value) => String(Number(value) * 10), header: 'TENS', key: 'count' },
        ],
      }),
    },
    'empty-default': { rows: [], view: table<Row>() },
    'empty-explicit': { rows: [], view: table<Row>({ columns: ['source', 'count'] }) },
    escape: {
      rows: [{ authored: marker, raw: marker }],
      view: table<Row>({ columns: ['raw', { format: (value) => String(value), key: 'authored' }] }),
    },
    'escaped-key': {
      rows: [{ [marker]: 'value' }],
      view: table<Row>(),
    },
    explicit: {
      rows: [
        { count: 6, source: 'one.txt' },
        { count: 2, source: 'two words.txt' },
      ],
      view: table<Row>({
        columns: [{ align: 'right', header: 'COUNT', key: 'count' }, 'source'],
      }),
    },
    large: {
      discardOutput: true,
      rows: Array.from({ length: 150_000 }, () => ({ value: 'x' })),
      view: table<Row>(),
    },
    'last-center': {
      rows: [{ value: 'x' }],
      view: table<Row>({ columns: [{ align: 'center', header: 'ABCD', key: 'value' }] }),
    },
    nullish: {
      rows: [{ end: 'x', missing: undefined, nullish: null }],
      view: table<Row>({ columns: ['nullish', 'missing', 'end'] }),
    },
    'styled-wide': {
      rows: [
        { count: 1, label: '猫猫' },
        { count: 20, label: 'styled' },
      ],
      view: table<Row>({
        columns: [
          {
            format: (value, _row, { style }) => style.red(String(value)),
            header: 'N',
            key: 'label',
          },
          { align: 'right', key: 'count' },
        ],
      }),
    },
  };

  const selected = cases[scenario];
  if (selected === undefined) {
    throw new Error(`Unknown fixture scenario: ${scenario}`);
  }

  const app = selected.declared
    ? new Application('table')
        .rows<(typeof selected.rows)[number]>({ views: { table: selected.view } })
        .action(({ out }) => out.results(selected.rows))
    : new Application('table').action(({ out }) => out.render(selected.rows, selected.view));

  return await runOnMock(
    app,
    { argv: [] },
    {
      ...(selected.discardOutput
        ? {
            stdout: new Writable({
              write(_chunk, _encoding, done) {
                done();
              },
            }),
          }
        : {}),
      afterRun: (mock) => mock.stdout.write(`resolved:${String(mock.exitCode)}\n`),
    },
  );
}

export { run };
