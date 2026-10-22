import { Command } from '@loomcli/core';

import { printSplits } from '../actions/splits.js';
import { distance, time } from '../validators.js';

export const splits = new Command('splits', {
  description: 'List the time of each split of a run.',
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
  // #region every
  .option('every', {
    description: 'How long each split is, such as 1k, 1mi, or 400m. Defaults to one unit.',
    short: 'e',
    type: 'string',
    validate: distance,
  })
  // #endregion
  .option('negative', {
    description: 'Run the second half faster than the first.',
    short: 'n',
    type: 'boolean',
  })
  .action(printSplits);
