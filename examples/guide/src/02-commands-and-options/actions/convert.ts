import type { ActionHandler } from '@loomcli/core';

import type { convert } from '../commands/convert.js';
import { convertPace, formatPace, parsePace, parseUnit } from '../pace.js';

export const convertToUnit: ActionHandler<typeof convert> = ({ args, options, out, style }) => {
  const pace =
    parsePace(args.pace) ??
    out.fatal(
      `Cannot read the pace "${style.escape(args.pace)}". Write a time and a unit, such as 5:00/km or 8:03/mi.`,
    );
  const unitName = options.unit ?? 'km';
  const unit =
    parseUnit(unitName) ?? out.fatal(`Unknown unit "${style.escape(unitName)}". Use km or mi.`);
  return out.print(formatPace(convertPace(pace, unit)));
};
