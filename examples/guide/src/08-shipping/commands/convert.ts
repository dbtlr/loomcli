import { Command } from '@loomcli/core';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { convertToUnit } from '../actions/convert.js';
import type { Pace } from '../pace.js';
import { pace } from '../validators.js';
import { paceView } from '../views.js';

export const convert = new Command('convert', {
  description: 'Give a pace per kilometre as a pace per mile, or the other way round.',
  extensions: [mcpCommand({ annotations: { idempotent: true, openWorld: false, readOnly: true } })],
})
  .argument('pace', {
    description: 'The pace to convert, such as 5:00/km or 8:03/mi.',
    required: true,
    validate: pace,
  })
  .result<Pace>({ views: { text: paceView } })
  .action(convertToUnit);
