import type {
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
  // @ts-expect-error TS2345: A frame's view reads the data drawn.
  await region.draw('two', ticking);
  // @ts-expect-error TS2345: End takes "ended", "failed", or nothing.
  await region.end('done');
  // @ts-expect-error TS2322: A report's completed is a number.
  region.report({ completed: '3' });
  // @ts-expect-error TS2322: A region's input is a Boolean.
  out.region({ input: 'yes' });
  return { closedBy, live, signal };
});

/** A progress event's fields, as an observer reads them. */
const event: ProgressEvent = { id: 1, label: 'Fetching', state: 'updated' };

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
const declared = progressLine;

export { declared, drawn, event, line, tracked };
