import {
  Application,
  FatalError,
  InputError,
  issuePath,
  lanes,
  override,
  plugin,
  UnknownCommandError,
  UsageError,
  view,
} from '@loomcli/core';
import type {
  ApplicationOptions,
  DeclaredRowView,
  DeclaredView,
  InputProblem,
  LoomError,
  RowView,
  View,
  ViewOverride,
} from '@loomcli/core';

interface Row {
  count: number;
  source: string;
}

const table: View<readonly Row[]> = {
  render: (rows) => rows.map((row) => `${String(row.count)}  ${row.source}\n`).join(''),
};
const counts: View<number> = { render: (value) => String(value) };

/** The row view shape: one function per row, and the two that open and close the sequence. */
const lines: RowView<Row> = {
  head: () => 'COUNT  SOURCE\n',
  row: (row, index) => `${String(index)}  ${String(row.count)}  ${row.source}\n`,
};

/** An asynchronous source, which the sequence overload accepts beside a synchronous one. */
async function* walk(): AsyncGenerator<Row> {
  yield { count: 6, source: 'one.txt' };
}

new Application('render').action(async ({ out }) => {
  const rows: readonly Row[] = [{ count: 6, source: 'one.txt' }];
  await out.render(rows, table);
  await out.render(rows.length, counts);
  // A declared view renders through the same call a bare view does.
  await out.render('ready', lanes.print);
  // The second overload takes a row view over an iterable or an asynchronous iterable.
  await out.render(rows, lines);
  await out.render(walk(), lines);
  await out.render(rows, paths);
  // @ts-expect-error TS2769: A view for another value type cannot read these rows.
  await out.render(rows, counts);
  // @ts-expect-error TS2769: A view returns the text core writes, never another value.
  await out.render(rows, { render: (data) => data.length });
  // @ts-expect-error TS2769: A view has one shape, so a value with render and row is neither.
  await out.render(rows, { render: () => '', row: () => '' });
  // @ts-expect-error TS2769: A row view for another row type cannot read these rows.
  await out.render(rows, { row: (row: { name: string }) => row.name });
});

/** A declared view of the application's own data, named by reference wherever it is used. */
const summary: DeclaredView<readonly Row[]> = view<readonly Row[]>('@fixture/rows', {
  render: (rows) => `${String(rows.length)}\n`,
});

/** A declared row view, which carries the same brand and invariance a declared view carries. */
const paths: DeclaredRowView<Row> = view<Row>('@fixture/paths', {
  row: (row) => `${row.source}\n`,
});

// @ts-expect-error TS2769: A view function's array parameter is always readonly.
view<readonly Row[]>('@fixture/mutable', { render: (rows: Row[]) => String(rows.length) });
// @ts-expect-error TS2769: The inferred data type reads through Readonly, so the same rule holds.
view('@fixture/inferred', { render: (rows: Row[]) => String(rows.length) });
// @ts-expect-error TS2769: A mutable array parameter is rejected under any type argument.
view<Row[]>('@fixture/mutable-argument', { render: (rows: Row[]) => String(rows.length) });
// @ts-expect-error TS2769: A primitive parameter is stated, because inference runs through Readonly.
view('@fixture/primitive', { render: (message: string) => message });
// @ts-expect-error TS2769: A union parameter is stated in full, for the same reason.
view('@fixture/union', { render: (value: number | string) => String(value) });

/** An application's own fatal type, so overriding it implies the view for it. */
class ConfigError extends FatalError {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const problems: View<InputError> = {
  render: (failure) => failure.problems.map((problem) => describe(problem)).join('\n'),
};
const unknownCommand: View<UnknownCommandError> = {
  render: (failure) => `unknown command "${failure.token}"; try ${failure.candidates.join(', ')}`,
};
const anyFailure: View<LoomError> = {
  render: (failure) => `${String(failure.exitCode)}: ${failure.message}`,
};

function describe(problem: InputProblem): string {
  return problem.reason === 'missing'
    ? `${problem.spelling}: required`
    : problem.issues
        .map((issue) => {
          const path: string | undefined = issuePath(issue);
          return `${problem.spelling}${path === undefined ? '' : ` at ${path}`}: ${issue.message}`;
        })
        .join('\n');
}

const views: readonly ViewOverride[] = [
  override(InputError, problems),
  override(UnknownCommandError, unknownCommand),
  override(UsageError, anyFailure),
  override(ConfigError, { render: (failure) => failure.message }),
  override(lanes.warn, { render: (message) => message.toUpperCase() }),
  override(summary, table),
  override(paths, lines),
];

// @ts-expect-error TS2769: A class outside the failure hierarchy has no failure to render.
override(Error, anyFailure);
// @ts-expect-error TS2769: A view for another class cannot answer this one.
override(UnknownCommandError, problems);
// @ts-expect-error TS2769: A view for one subclass cannot answer every UsageError.
override(UsageError, problems);
// @ts-expect-error TS2769: A replacement cannot require data the key does not carry.
override(lanes.warn, table);
// @ts-expect-error TS2769: A replacement for another data type cannot answer this declared view.
override(summary, counts);
// @ts-expect-error TS2769: A declared row view takes a row view as its replacement.
override(paths, table);

const usageFailure: View<UsageError> = {
  render: (failure) => `${String(failure.exitCode)}: ${failure.message}`,
};
override(InputError, usageFailure);

/** A plugin lists the views it declares and the overrides it makes in one list. */
const branding = plugin('@fixture/branding', {
  views: [summary, paths, override(summary, table), override(InputError, problems)],
});

const configured: ApplicationOptions = { plugins: [branding], views };

new Application('inline', {
  views,
})
  .globalOption('file', { required: true, type: 'string' })
  .action(({ options }) => {
    const file: string = options.file;
    return file;
  });

new Application('views-only', { views }).action(({ options }) => {
  // @ts-expect-error TS2339: An Application without globals gains no global keys.
  options.file;
});

// @ts-expect-error TS2741: An application overrides and does not declare, so views holds overrides.
new Application('declaring', { views: [summary] });

// @ts-expect-error TS2353: Constructor globals wiring is retired.
new Application('retired', { globals: {} });
// @ts-expect-error TS2353: Constructor failure registration is retired.
new Application('retired-failures', { failures: [] });

export const jsonkit = new Application('jsonkit', configured)
  .globalOption('file', { required: true, type: 'string' })
  .option('pretty', { type: 'boolean' })
  .action(({ options, out }) => out.print(`${options.file}:${String(options.pretty)}`));

// @ts-expect-error TS2375: A declared view is invariant, so it names one data type alone.
export const reassigned: DeclaredView<number> = summary;
