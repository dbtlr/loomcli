import type { ActionHandler } from '@loomcli/core';

import type { calc } from '../commands/calc.js';
import { formatPace, paceOf } from '../pace.js';

export const calculatePace: ActionHandler<typeof calc> = ({ args, options, out }) =>
  out.print(formatPace(paceOf(args.distance, args.time, options.unit)));
