import { Command } from '@loomcli/core';

import { convertToUnit } from '../actions/convert.js';
import { pace } from '../validators.js';

export const convert = new Command('convert', {
  description: 'Give a pace per kilometre as a pace per mile, or the other way round.',
})
  .argument('pace', {
    description: 'The pace to convert, such as 5:00/km or 8:03/mi.',
    required: true,
    validate: pace,
  })
  .action(convertToUnit);
