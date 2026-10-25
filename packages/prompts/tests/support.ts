import type { Out, RegionOptions } from '@loomcli/core';
import type { MockProcess } from '@loomcli/testing';

import type { Recorded } from '../../../scripts/test-screen.js';

/** One frame a region drew, with the options its region opened under. */
export interface Frame {
  /** Draws this frame once more through `out`, answering the rows it moves down. */
  readonly again: (out: Pick<Out, 'draw'>) => Promise<number>;
  readonly data: unknown;
  readonly options: RegionOptions | undefined;
  readonly view: unknown;
}

/**
 * `out` with each region it opens observed: `afterDraw` runs once the region has drawn each frame,
 * before the question reads its next key. A test uses it to resize, abort, or note a point at a
 * frame the scripted keys cannot name.
 */
export function observing<Observed extends Pick<Out, 'region'>>(
  out: Observed,
  afterDraw: (frame: Frame) => void | Promise<void>,
): Observed {
  return {
    ...out,
    region: (options) => {
      const region = out.region(options);
      return {
        get closedBy() {
          return region.closedBy;
        },
        draw: async (data, view) => {
          await region.draw(data, view);
          await afterDraw({ again: (target) => target.draw(data, view), data, options, view });
        },
        end: (state, label) => region.end(state, label),
        get live() {
          return region.live;
        },
        report: (progress) => region.report(progress),
        signal: region.signal,
      };
    },
  };
}

/**
 * Records the order of a mock terminal's stderr writes, the resizes a test makes, and the points
 * it marks, which a headless terminal emulator then replays.
 */
export function recording(mock: MockProcess) {
  const points: { readonly at: number; readonly event: Recorded }[] = [];
  const note = (event: Recorded) => {
    points.push({ at: mock.transcript.length, event });
  };
  return {
    /** The writes with the resizes and marks between them, in the order they happened. */
    events(): Recorded[] {
      const events: Recorded[] = [];
      const writes = mock.transcript.map((entry, index) => ({ entry, index }));
      for (const { entry, index } of writes) {
        events.push(...points.filter((point) => point.at === index).map((point) => point.event));
        if (entry.stream === 'stderr') {
          events.push({ write: entry.text });
        }
      }
      events.push(
        ...points.filter((point) => point.at >= mock.transcript.length).map((point) => point.event),
      );
      return events;
    },
    /** Notes a named point in the event order. */
    mark(name: string): void {
      note({ mark: name });
    },
    /** Resizes the terminal between writes, as an operator does. */
    resize(columns: number, rows = 24): void {
      mock.resize(columns, rows);
      note({ resize: columns });
    },
  };
}
