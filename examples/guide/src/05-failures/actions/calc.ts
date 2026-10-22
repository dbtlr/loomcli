import type { ActionHandler } from '@loomcli/core';

import type { calc } from '../commands/calc.js';
import { paceOf } from '../pace.js';

export const calculatePace: ActionHandler<typeof calc> = ({ args, options, out }) =>
  out.results(paceOf(args.distance, args.time, options.unit));
