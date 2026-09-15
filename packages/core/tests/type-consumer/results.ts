import { Application, Command } from '@loomcli/core';
import type {
  ActionHandler,
  MiddlewareContext,
  ResultViews,
  RowView,
  RowViews,
  View,
} from '@loomcli/core';

interface Row {
  count: number;
  source: string;
}

interface Table {
  rows: readonly Row[];
  total: number;
}

const table: View<Table> = { render: ({ total }) => `${String(total)}\n` };
const wide: View<Table> = { render: ({ rows }) => `${String(rows.length)}\n` };
const collected: View<readonly Row[]> = { render: (rows) => `${String(rows.length)}\n` };
const list: RowView<Row> = { head: () => 'ROWS\n', row: (row) => `${row.source}\n` };
const both = { render: () => '', row: () => '' };

/** The two sequence shapes an action may hand a rows declaration, beside an array. */
function* walk(): Generator<Row> {
  yield { count: 1, source: 'one.txt' };
}
async function* stream(): AsyncGenerator<Row> {
  yield { count: 1, source: 'one.txt' };
}

// A Command declares one result, and the type argument is stated by the author.
const count = new Command('count')
  .argument('files', { required: true, variadic: true })
  .result<Table>({ views: { table } })
  .action(({ out }) => out.results({ rows: [], total: 0 }));

const paths = new Command('paths')
  .rows<Row>({ views: { collected, list } })
  .action(({ out }) => out.results(walk()));

const plain = new Command('plain').action(({ out }) => out.print('ready'));

// The same two calls on the Application, for its root action.
const valueRoot = new Application('value-root')
  .result<Table>({ views: { table } })
  .action(({ out }) => out.results({ rows: [], total: 0 }));
const rowsRoot = new Application('rows-root')
  .rows<Row>({ views: { list } })
  .action(({ out }) => out.results(stream()));

// An extracted action reads its result from the declaration it type-imports.
const countAction: ActionHandler<typeof count> = async ({ args, out }) => {
  const files: string[] = args.files;
  await out.results({ rows: files.map((source) => ({ count: 1, source })), total: files.length });
};
const pathsAction: ActionHandler<typeof paths> = async ({ out }) => {
  await out.results([{ count: 1, source: 'one.txt' }]);
  await out.results(walk());
  await out.results(stream());
};
const rootAction: ActionHandler<typeof valueRoot> = ({ out }) =>
  out.results({ rows: [], total: 0 });

// `views()` is published in every state on a declaration that carries a result.
const branded = count.views({ wide }, { default: 'wide' });
// The record takes the shape its declaration carries, so rows accept either view shape.
const brandedRows = paths.views({ collected });
const relisted = paths.views({ list }, { default: 'list' });
const brandedRoot = valueRoot.views({ wide });

// A neutral annotation and an attachment accept a declaration that carries a result.
const neutral: Command = count;
const attached = new Application('graph')
  .command(count)
  .command(paths)
  .action(({ out }) => out.print('ready'));

// The records are the two the declarations name, read by their own types.
const valueRecord: ResultViews<Table> = { table, wide };
const rowRecord: RowViews<Row> = { collected, list };

const noResult: ActionHandler<typeof plain> = async ({ out }) => {
  // @ts-expect-error TS2345: A Command that declares no result accepts no value.
  await out.results({ rows: [], total: 0 });
};

const whole: Table = { rows: [], total: 0 };
const fromMiddleware = async ({ out }: MiddlewareContext) => {
  // @ts-expect-error TS2345: Only the action emits a result, so a middleware's out takes never.
  await out.results(whole);
};

const wrongValue: ActionHandler<typeof count> = async ({ out }) => {
  // @ts-expect-error TS2739: A value result takes the declared value, never a sequence of it.
  await out.results(walk());
};
const wrongRows: ActionHandler<typeof paths> = async ({ out }) => {
  // @ts-expect-error TS2345: A rows result takes a sequence of rows, never one whole value.
  await out.results(whole);
};

// @ts-expect-error TS2322: A view has one shape, so a value with render and row is neither.
new Command('both-shapes').result<Table>({ views: { both } });
// @ts-expect-error TS2322: The same rule holds in a views() call.
count.views({ both });
// @ts-expect-error TS2322: A row view answers a rows declaration, never a value result.
new Command('row-on-value').result<Table>({ views: { list } });
// @ts-expect-error TS2322: The same rule holds in a views() call.
count.views({ list });
// @ts-expect-error TS2339: A Command that registered its action declares no result.
plain.result;
// @ts-expect-error TS2339: The same holds for the sequence call.
plain.rows;
// @ts-expect-error TS2339: A Command declares one result, so the second call is gone.
new Command('twice').result<Table>({ views: { table } }).rows;
// @ts-expect-error TS2339: The same holds from the other side.
new Command('twice-rows').rows<Row>({ views: { list } }).result;
// @ts-expect-error TS2339: A declaration with no result publishes no views() call.
plain.views;

void countAction;
void pathsAction;
void rootAction;
void branded;
void brandedRows;
void relisted;
void brandedRoot;
void neutral;
void attached;
void valueRecord;
void rowRecord;
void noResult;
void fromMiddleware;
void wrongValue;
void wrongRows;
void rowsRoot;
