import type { ActionHandler } from '@loomcli/core';

import type { convert } from '../commands/convert.js';
import { convertPace } from '../pace.js';

export const convertToUnit: ActionHandler<typeof convert> = ({ args, options, out }) =>
  out.results(convertPace(args.pace, options.unit));
