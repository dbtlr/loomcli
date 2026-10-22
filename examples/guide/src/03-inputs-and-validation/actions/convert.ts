import type { ActionHandler } from '@loomcli/core';

import type { convert } from '../commands/convert.js';
import { convertPace, formatPace } from '../pace.js';

export const convertToUnit: ActionHandler<typeof convert> = ({ args, options, out }) =>
  out.print(formatPace(convertPace(args.pace, options.unit)));
