import { optionSet } from '@loomcli/core';
import { integer } from '@loomcli/validators';

/**
 * How a Command that prints a JSON value lays it out. jq spells the same two settings
 * `--compact-output` and `--indent n`. Every Command that prints JSON applies this set, so each
 * one takes both options and their exclusive group, and `get` and `fetch`, which share one action,
 * read one option type.
 */
export const jsonLayout = optionSet({
  compact: { description: 'Print the JSON on one line.', type: 'boolean' },
  indent: {
    default: '2',
    description: 'Indent nested JSON by this many spaces, from 0 to 8.',
    type: 'string',
    validate: integer({ max: 8, min: 0 }),
  },
}).exclusive('compact', 'indent');
