import type { ActionHandler } from '@loomcli/core';

import type { splits } from '../commands/splits.js';
import { splitCount, splitRun, unitLength } from '../pace.js';

/** The most splits pace lists for one run. */
const mostSplits = 1000;

export const listSplits: ActionHandler<typeof splits> = ({ args, options, out }) => {
  const { distance: metres, time: seconds } = args;
  const { negative, unit } = options;
  // With no --every, each split is one unit long.
  const every = options.every ?? unitLength(unit);
  const count = splitCount(metres, every);
  if (count > mostSplits) {
    out.fatal(
      `The run makes ${String(count)} splits, and pace lists at most ${String(mostSplits)}. Supply a longer --every, such as 1k.`,
    );
  }
  return out.results(splitRun({ every, metres, negative, seconds, unit }));
};
