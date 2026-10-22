import type { ActionHandler } from '@loomcli/core';

import type { splits } from '../commands/splits.js';
import { splitRun, unitLength } from '../pace.js';

export const listSplits: ActionHandler<typeof splits> = ({ args, options, out }) => {
  const { distance: metres, time: seconds } = args;
  const { negative, unit } = options;
  // With no --every, each split is one unit long.
  const every = options.every ?? unitLength(unit);
  return out.results(splitRun({ every, metres, negative, seconds, unit }));
};
