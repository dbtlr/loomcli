import { Application, style } from '@loomcli/core';
import type { ApplicationOptions, Out, RowView, RowViews, RunOptions, View } from '@loomcli/core';
import { loomTheme } from '@loomcli/plugins/theme';
import { mockProcess } from '@loomcli/testing';
import type { MockProcess } from '@loomcli/testing';
import { expect } from 'vite-plus/test';

/** The run a view case renders in. */
interface ViewRun {
  /** One render per entry: a number is a terminal that wide, and null is a pipe. */
  readonly widths: readonly (number | null)[];
  readonly env?: Readonly<Record<string, string>>;
  readonly rendering?: RunOptions['rendering'];
  readonly build?: 'development' | 'distributed';
  /** Installs the Loom theme with `primary` in cyan, so it shows. */
  readonly theme?: boolean;
  /** Renders through an invocation by name, which has no terminal, and answers its output. */
  readonly invoke?: boolean;
  /** The Application's view overrides. */
  readonly views?: ApplicationOptions['views'];
}

/**
 * Splits the widths into runs of one kind, terminal or pipe, in order. A mock's stdout is on a
 * terminal or piped for its whole run, so a pipe render needs a mock of its own.
 */
function destinations(widths: readonly (number | null)[]): (number | null)[][] {
  const groups: (number | null)[][] = [];
  for (const width of widths) {
    const last = groups.at(-1);
    if (last !== undefined && (last[0] === null) === (width === null)) {
      last.push(width);
    } else {
      groups.push([width]);
    }
  }
  return groups;
}

/** A mock whose stdout alone is on a terminal as wide as the first width, or a pipe for null. */
function viewMock(run: ViewRun, first: number | null | undefined): MockProcess {
  return mockProcess({
    env: run.env ?? {},
    platform: 'linux',
    release: { build: run.build ?? 'distributed' },
    ...(first === null || first === undefined
      ? {}
      : { terminal: { columns: first, rows: 24, streams: ['stdout'] } }),
  });
}

/** The application every view case renders in, with the Loom theme when the run names it. */
function baseApplication(run: ViewRun) {
  return new Application('pack-views', {
    description: 'Render a pack view at a live width.',
    plugins: run.theme === true ? [loomTheme({ primary: style.cyan })] : [],
    views: run.views ?? [],
  });
}

/**
 * Runs the application on the mock and answers its stdout, after the run wrote exit code 0 to the
 * mock and nothing to stderr.
 */
async function rendered(app: Pick<Application, 'run'>, mock: MockProcess, run: ViewRun) {
  await app.run({
    process: mock,
    rendering: run.rendering ?? { color: 'never', modifiers: 'never' },
  });
  expect(mock.stderr.text).toBe('');
  expect(mock.exitCode).toBe(0);
  return mock.stdout.text;
}

/**
 * What `draw` printed once per width, the width changed live between renders and `--` printed
 * between them. Terminal and pipe renders run on separate mocks, joined by the separator.
 */
async function renderEach(run: ViewRun, draw: (out: Out) => Promise<void>): Promise<string> {
  const outputs: string[] = [];
  for (const widths of destinations(run.widths)) {
    const mock = viewMock(run, widths[0]);
    const app = baseApplication(run).action(async ({ out }) => {
      for (const [index, width] of widths.entries()) {
        if (width !== null) {
          mock.resize(width, 24);
        }
        if (index > 0) {
          await out.print('--');
        }
        await draw(out);
      }
    });
    if (run.invoke === true) {
      const outcome = await app.invoke([], {}, { process: mock });
      // An invocation by name writes to neither of the handle's streams.
      expect(mock.stderr.text).toBe('');
      expect(mock.stdout.text).toBe('');
      if (outcome.status !== 'completed') {
        throw new Error(`The invocation ended ${outcome.status}.`);
      }
      outputs.push(outcome.output);
    } else {
      outputs.push(await rendered(app, mock, run));
    }
  }
  return outputs.join('--\n');
}

/** What a declared string result prints through `out.results`, its default view `view`. */
async function renderResult(run: ViewRun, data: string, view: View<string>): Promise<string> {
  const mock = viewMock(run, run.widths[0]);
  const app = baseApplication(run)
    .result<string>({ views: { view } })
    .action(({ out }) => out.results(data));
  return await rendered(app, mock, run);
}

/** What a declared rows result prints through `out.results`, its views `views`. */
async function renderRows<Row>(
  run: ViewRun,
  rows: readonly Row[],
  views: RowViews<Row>,
): Promise<string> {
  const mock = viewMock(run, run.widths[0]);
  const app = baseApplication(run)
    .rows<Row>({ views })
    .action(({ out }) => out.results(rows));
  return await rendered(app, mock, run);
}

/**
 * What a row view prints over a source that yields one row per width, the terminal resized to
 * that width before the source yields the row.
 */
async function renderStream<Row>(
  run: ViewRun,
  rows: readonly Row[],
  view: RowView<Row>,
): Promise<string> {
  const mock = viewMock(run, run.widths[0]);
  async function* streamed() {
    for (const [index, row] of rows.entries()) {
      const width = run.widths[index];
      if (typeof width === 'number') {
        mock.resize(width, 24);
      }
      yield row;
    }
  }
  const app = baseApplication(run).action(async ({ out }) => {
    await out.render(streamed(), view);
  });
  return await rendered(app, mock, run);
}

export { renderEach, renderResult, renderRows, renderStream };
export type { ViewRun };
