import type { ActionHandler } from '@loomcli/core';

import type { splits } from '../commands/splits.js';
import { formatSplit, parseDistance, parseTime, parseUnit, splitRun, unitLength } from '../pace.js';

export const printSplits: ActionHandler<typeof splits> = async ({ args, options, out, style }) => {
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
  // #region every
  // With no --every, each split is one unit long.
  const everyText = options.every;
  const every =
    everyText === undefined
      ? unitLength(unit)
      : (parseDistance(everyText) ??
        out.fatal(
          `Cannot read the split "${style.escape(everyText)}". Write one such as 1k, 1mi, or 400m.`,
        ));
  for (const split of splitRun({ every, metres, negative: options.negative, seconds, unit })) {
    await out.print(formatSplit(split));
  }
  // #endregion
};
