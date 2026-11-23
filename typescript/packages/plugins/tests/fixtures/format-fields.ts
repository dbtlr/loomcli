import { Application, Command } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';

import { runOnMock } from './in-process.ts';

/** One entry the fixture's Commands report; the second lacks `owner`. */
interface Entry {
  name: string;
  size: number;
  owner?: string;
}

const entries: Entry[] = [
  { name: 'a', owner: 'x', size: 1 },
  { name: 'b', size: 2 },
];

/** A text view that declares no media type, the default of every Command below. */
const text = { render: () => 'text\n' };

/** A row view that declares no media type, the default of every rows Command below. */
const records = { row: () => 'record\n' };

/** The rows `mixed` yields: an object, then a number, which holds no fields. */
function* mixedRows(): Generator {
  yield { name: 'a' };
  yield 5;
}

/**
 * The application: `get` reports one entry, `ls` an array of them, `list` the same entries as rows,
 * `scalar` a string, `mixed` an object row then a number row, `empty` an object with no keys, and
 * `cache` is a group over `clear`.
 */
function application() {
  const clear = new Command('clear')
    .result<Entry>({ views: { text } })
    .action(({ out }) => out.results(entries[0] ?? { name: '', size: 0 }));
  return new Application('app', { plugins: [help(), format()] })
    .command(
      new Command('get')
        .result<Entry>({ views: { text } })
        .action(({ out }) => out.results(entries[0] ?? { name: '', size: 0 })),
    )
    .command(
      new Command('ls')
        .result<Entry[]>({ views: { text } })
        .action(({ out }) => out.results(entries)),
    )
    .command(
      new Command('list')
        .rows<Entry>({ views: { records } })
        .action(({ out }) => out.results(entries)),
    )
    .command(
      new Command('scalar')
        .result<string>({ views: { text } })
        .action(({ out }) => out.results('a')),
    )
    .command(
      new Command('mixed')
        .rows<unknown>({ views: { records } })
        .action(({ out }) => out.results(mixedRows())),
    )
    .command(
      new Command('empty').result<object>({ views: { text } }).action(({ out }) => out.results({})),
    )
    .command(new Command('cache').command(clear));
}

/** Runs the application with the given words and returns the process effects. */
async function run(argv: string[]) {
  return await runOnMock(application(), { argv, release: { build: 'distributed' } });
}

/** The graph `inspect()` returns for the application. */
function inspect() {
  return application().inspect();
}

export { application, inspect, run };
