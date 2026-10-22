import { Command } from '@loomcli/core';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { calculatePace } from '../actions/calc.js';
import type { Pace } from '../pace.js';
import { distance, time } from '../validators.js';
import { paceView } from '../views.js';

export const calc = new Command('calc', {
  description: 'Work out the pace of a run.',
  extensions: [mcpCommand({ annotations: { idempotent: true, openWorld: false, readOnly: true } })],
})
  .argument('distance', {
    description: 'How far you ran, such as 10k, 5mi, 400m, half, or marathon.',
    required: true,
    validate: distance,
  })
  .argument('time', {
    description: 'How long the run took, as mm:ss or h:mm:ss.',
    required: true,
    validate: time,
  })
  .result<Pace>({ views: { text: paceView } })
  .action(calculatePace);
