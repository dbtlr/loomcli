import { Application } from '@loomcli/core';
import type { RowView, View } from '@loomcli/core';
import { records } from '@loomcli/plugins/records';

import { runOnMock } from './in-process.ts';

/** Runs the fixture on isolated process facts and returns its recorded output. */
type Row = Record<string, unknown>;

async function run(args: string[] = []) {
  const scenario = args[0] ?? 'default';

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
      rows: [{ key: 'user', kind: 'object' }],
      view: records<Row>({ identifier: 'key' }),
    },
    default: {
      rows: [
        { key: 'user', kind: 'object with 3 keys' },
        { key: 'tags', kind: 'array with 2 items' },
      ],
      view: records<Row>({ identifier: 'key' }),
    },
    empty: { rows: [], view: records<Row>({ identifier: 'key' }) },
    escape: {
      rows: [{ authored: marker, key: 'one', raw: marker }],
      view: records<Row>({
        fields: ['raw', { format: (value) => String(value), key: 'authored' }],
        identifier: 'key',
      }),
    },
    'escaped-key': {
      rows: [{ [marker]: 'value' }],
      view: records<Row>({ identifier: marker }),
    },
    explicit: {
      rows: [
        { key: 'user', kind: 'object' },
        { key: 'tags', kind: 'array' },
      ],
      view: records<Row>({ fields: ['kind', 'key'], identifier: 'key' }),
    },
    'identifier-omitted': {
      rows: [{ key: 'user', kind: 'object' }],
      view: records<Row>({ fields: ['kind'], identifier: 'key' }),
    },
    nullish: {
      rows: [{ key: 'one', missing: undefined, nullish: null }],
      view: records<Row>({ fields: ['nullish', 'missing', 'key'], identifier: 'key' }),
    },
    'row-width': {
      rows: [
        { longest: 'b', short: 'a' },
        { xx: 'c', yy: 'd' },
      ],
      view: records<Row>({ identifier: 'short' }),
    },
  };

  const selected = cases[scenario];
  if (selected === undefined) {
    throw new Error(`Unknown fixture scenario: ${scenario}`);
  }

  const app = selected.declared
    ? new Application('records')
        .rows<(typeof selected.rows)[number]>({ views: { records: selected.view } })
        .action(({ out }) => out.results(selected.rows))
    : new Application('records').action(({ out }) => out.render(selected.rows, selected.view));

  return await runOnMock(
    app,
    { argv: [] },
    {
      afterRun: (mock) => mock.stdout.write(`resolved:${String(mock.exitCode)}\n`),
    },
  );
}

export { run };
