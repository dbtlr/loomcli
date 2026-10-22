import { Command } from '@loomcli/core';

import { calculatePace } from '../actions/calc.js';

export const calc = new Command('calc', { description: 'Work out the pace of a run.' })
  .argument('distance', {
    description: 'How far you ran, such as 10k, 5mi, 400m, half, or marathon.',
    required: true,
  })
  .argument('time', {
    description: 'How long the run took, as mm:ss or h:mm:ss.',
    required: true,
  })
  .action(calculatePace);
