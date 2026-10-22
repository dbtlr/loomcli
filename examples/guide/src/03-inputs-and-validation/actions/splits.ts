import type { ActionHandler } from '@loomcli/core';

import type { splits } from '../commands/splits.js';
import { formatSplit, splitRun, unitLength } from '../pace.js';

export const printSplits: ActionHandler<typeof splits> = async ({ args, options, out }) => {
  const { distance: metres, time: seconds } = args;
  const { negative, unit } = options;
  // With no --every, each split is one unit long.
  const every = options.every ?? unitLength(unit);
  for (const split of splitRun({ every, metres, negative, seconds, unit })) {
    await out.print(formatSplit(split));
  }
};
