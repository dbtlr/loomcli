import type { ActionHandler } from '@loomcli/core';

import type { calc } from '../commands/calc.js';
import { formatPace, paceOf, parseDistance, parseTime, parseUnit } from '../pace.js';

export const calculatePace: ActionHandler<typeof calc> = ({ args, options, out, style }) => {
  const metres =
    parseDistance(args.distance) ??
    out.fatal(
      `Cannot read the distance "${style.escape(args.distance)}". Write one such as 10k, 5mi, 400m, half, or marathon.`,
    );
  const seconds =
    parseTime(args.time) ??
    out.fatal(
      `Cannot read the time "${style.escape(args.time)}". Write it as mm:ss or h:mm:ss, such as 25:30.`,
    );
  const unitName = options.unit ?? 'km';
  const unit =
    parseUnit(unitName) ?? out.fatal(`Unknown unit "${style.escape(unitName)}". Use km or mi.`);
  return out.print(formatPace(paceOf(metres, seconds, unit)));
};
