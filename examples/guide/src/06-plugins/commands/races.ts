import { Command } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';

import { listRaces } from '../actions/races.js';
import type { Race } from '../pace.js';
import { kilometresCell } from '../views.js';

export const races = new Command('races', { description: 'List the races pace knows by name.' })
  .rows<Race>({
    views: {
      table: table({
        columns: [
          { header: 'RACE', key: 'name' },
          { align: 'right', format: kilometresCell, header: 'DISTANCE', key: 'metres' },
        ],
      }),
    },
  })
  .action(listRaces);
