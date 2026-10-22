import type { View } from '@loomcli/core';

import { formatDuration, formatPace } from './pace.js';
import type { Pace, Split } from './pace.js';

/** The default view of a pace result: one line, such as `5:00 /km`. */
export const paceView: View<Pace> = {
  render: (pace) => `${formatPace(pace)}\n`,
};

/** A split's distance cell, such as `5 km`. */
export function distanceCell(distance: number, split: Readonly<Split>): string {
  return `${String(distance)} ${split.unit}`;
}

/** A cell that holds a duration in seconds, such as `25:00`. */
export function durationCell(seconds: number): string {
  return formatDuration(seconds);
}
