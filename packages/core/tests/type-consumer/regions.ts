import type {
  Out,
  ProgressEvent,
  ProgressReport,
  Region,
  RegionCloser,
  RegionOptions,
  View,
} from '@loomcli/core';
import { Application, plugin } from '@loomcli/core';
import { progress, progressStyle } from '@loomcli/prompts';
import type { Progress, ProgressContext, Spinner } from '@loomcli/prompts';
import { progressLine } from '@loomcli/prompts/views';
import type { ProgressLine } from '@loomcli/prompts/views';

/** A frame view over a count, which a region draws. */
const ticking: View<number> = { render: (tick) => '.'.repeat(tick) };

/** An action's region: its facts read typed, and its calls take the declared shapes. */
const drawn = new Application('drawn').action(async ({ out }) => {
  const options: RegionOptions = { input: false };
  const region: Region = out.region(options);
  const live: boolean = region.live;
  const signal: AbortSignal = region.signal;
  const closedBy: RegionCloser | undefined = region.closedBy;
  const report: ProgressReport = { completed: 1, label: 'Waiting', total: 3 };
  region.report(report);
  await region.draw(2, ticking);
  await region.end('failed');
  await out.region().end('skipped', 'Fetched nothing: the cache is fresh');
  await out.region().end('warned');
  // @ts-expect-error TS2345: A frame's view reads the data drawn.
  await region.draw('two', ticking);
  // @ts-expect-error TS2345: End takes "ended", "failed", "skipped", "warned", or nothing.
  await region.end('done');
  // @ts-expect-error TS2345: A cleared line ends as "ended", so end takes no "cleared".
  await region.end('cleared');
  // @ts-expect-error TS2322: A report's completed is a number.
  region.report({ completed: '3' });
  // @ts-expect-error TS2322: A report's total is a number.
  region.report({ total: '3' });
  // @ts-expect-error TS2322: A report's label is a string.
  region.report({ label: 3 });
  // @ts-expect-error TS2322: A region's input is a Boolean.
  out.region({ input: 'yes' });
  // @ts-expect-error TS2559: A region's options are an object.
  out.region(3);
  return { closedBy, live, signal };
});

/** A progress event's fields, as an observer reads them. */
const event = ({ completed, id, label, state, total }: ProgressEvent): string =>
  `${id} ${label} ${state} ${completed ?? '-'}/${total ?? '-'}`;

/** An observer's switch over every state an event takes, a skipped and a warned end included. */
function outcome(state: ProgressEvent['state']): string {
  switch (state) {
    case 'started':
    case 'updated': {
      return 'running';
    }
    case 'ended': {
      return 'done';
    }
    case 'skipped': {
      return 'nothing to do';
    }
    case 'warned': {
      return 'done with a warning';
    }
    case 'failed':
    case 'cancelled': {
      return 'stopped';
    }
  }
}

/** A middleware's context opens a progress line, as an action's does. */
const around = plugin('@fixture/around', {
  middleware: {
    activate: 'always',
    load: async () => ({
      default: async (context) => {
        const line: Progress = progress(context, { label: 'Around the run' });
        await context.next();
        await line.end();
      },
    }),
  },
});

/** An action's progress line, its handle, and the style plugin with a cli-spinners entry. */
const dots: Spinner = { frames: ['⠋', '⠙', '⠹'], interval: 80 };
const tracked = new Application('tracked', {
  plugins: [around, progressStyle({ bar: { complete: '█', incomplete: '░' }, spinner: dots })],
}).action(async (context) => {
  const reading: ProgressContext = context;
  const line = progress(reading, { label: 'Fetching', spinner: dots, total: 3 });
  line.update({ completed: 1 });
  await line.fail('It failed.');
  const count: number = await progress(context, { label: 'Indexing' }).track(Promise.resolve(3), {
    done: (value: number) => `Indexed ${String(value)}`,
    failed: (error: unknown) => String(error),
  });
  const ending: Progress = progress(context, { label: 'Fetching' });
  await ending.skip('Fetched nothing: the cache is fresh');
  await ending.warn();
  await ending.clear();
  // @ts-expect-error TS2554: A cleared line leaves no text, so clear takes no message.
  await ending.clear('Cleared');
  const lanes: Pick<Out, 'region' | 'draw' | 'info' | 'success' | 'error'> = context.out;
  // @ts-expect-error TS2741: A context passed to progress() carries the warn lane.
  progress({ graph: context.graph, out: lanes }, { label: 'Fetching' });
  const undrawn: Pick<Out, 'region' | 'info' | 'success' | 'warn' | 'error'> = context.out;
  // @ts-expect-error TS2741: A context passed to progress() carries draw, for a kept tree's end lines.
  progress({ graph: context.graph, out: undrawn }, { label: 'Deploying' });
  const deploying = progress(context, { keepTasks: true, label: 'Deploying' });
  const building: Progress = deploying.task({ label: 'Building the image', total: 3 });
  await building.task({ keepTasks: false, label: 'Compiling' }).end();
  await building.end('Built the image');
  await deploying.end('Deployed');
  // @ts-expect-error TS2345: A done function reads the tracked work's own value type.
  await progress(context, { label: 'Indexing' }).track(Promise.resolve(3), {
    done: (value: string) => value,
  });
  // @ts-expect-error TS2322: A label is a string.
  progress(context, { label: 3 });
  return count;
});

/** The progress view's data. */
const line: ProgressLine = {
  bar: { complete: '▰', incomplete: '▱' },
  completed: 6,
  elapsed: 2400,
  frame: '◓',
  label: 'Fetching records',
  state: 'running',
  total: 10,
};
/** A tree's data: a root with a task under it. */
const tree: ProgressLine = { ...line, depth: 0, tasks: [{ ...line, depth: 1, tasks: [] }] };
const declared = progressLine;

/** An override's switch over every state the progress view takes, a skipped and a warned end included. */
function drawnLine({ label, state }: ProgressLine): string {
  switch (state) {
    case 'running': {
      return `… ${label}`;
    }
    case 'ended': {
      return `done ${label}`;
    }
    case 'skipped': {
      return `skipped ${label}`;
    }
    case 'warned': {
      return `warning ${label}`;
    }
    case 'failed':
    case 'cancelled': {
      return `stopped ${label}`;
    }
  }
}

export { declared, drawn, drawnLine, event, line, outcome, tracked, tree };
