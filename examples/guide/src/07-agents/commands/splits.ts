import { Command } from '@loomcli/core';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';
import { records } from '@loomcli/plugins/records';
import { table } from '@loomcli/plugins/table';

import { listSplits } from '../actions/splits.js';
import { SplitTooLongError } from '../failures.js';
import type { Split } from '../pace.js';
import { distance, time } from '../validators.js';
import { distanceCell, durationCell } from '../views.js';

export const splits = new Command('splits', {
  description: 'List the time of each split of a run.',
  extensions: [
    manifestCommand({
      failures: [{ failure: SplitTooLongError, meaning: 'The split is longer than the run.' }],
    }),
    mcpCommand({ annotations: { idempotent: true, openWorld: false, readOnly: true } }),
  ],
})
  .alias('split')
  .argument('distance', {
    description: 'How far the run goes, such as 10k, 5mi, half, or marathon.',
    required: true,
    validate: distance,
  })
  .argument('time', {
    description: 'The time to finish in, as mm:ss or h:mm:ss.',
    required: true,
    validate: time,
  })
  .option('every', {
    description: 'How long each split is, such as 1k, 1mi, or 400m. Defaults to one unit.',
    short: 'e',
    type: 'string',
    validate: distance,
  })
  .option('negative', {
    description: 'Run the second half faster than the first.',
    short: 'n',
    type: 'boolean',
  })
  // The first view, the table, is the one a run renders unless --format names another.
  .rows<Split>({
    views: {
      table: table({
        columns: [
          { align: 'right', header: 'SPLIT', key: 'split' },
          { align: 'right', format: distanceCell, header: 'DISTANCE', key: 'distance' },
          { align: 'right', format: durationCell, header: 'TIME', key: 'time' },
          { align: 'right', format: durationCell, header: 'ELAPSED', key: 'elapsed' },
        ],
      }),

      records: records({
        fields: [
          'split',
          { format: distanceCell, key: 'distance' },
          { format: durationCell, key: 'time' },
          { format: durationCell, key: 'elapsed' },
        ],
        identifier: 'split',
      }),
    },
  })
  .action(listSplits);
