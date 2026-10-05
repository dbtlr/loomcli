import { Application, reportedSpelling } from '@loomcli/core';

/**
 * Options of every shape a reported spelling distinguishes: a long form with a short alias, each
 * Boolean polarity, a short-only option of each kind, an option that keeps aliases, and a count.
 */
const app = new Application('spelled')
  .globalOption('file', { short: 'f', type: 'string' })
  .option('quiet', { polarity: 'negative', type: 'boolean' })
  .option('color', { polarity: 'both', type: 'boolean' })
  .option('exact', { short: 'x', shortOnly: true, type: 'string' })
  .option('keep', { polarity: 'negative', short: 'k', shortOnly: true, type: 'boolean' })
  .option('min-bytes', { aliases: ['minimum', 'min'], type: 'string' })
  .option('verbose', { short: 'v', type: 'count' })
  .action(() => {});

const { globals, root } = app.inspect();
const reported = Object.fromEntries(
  [...globals, ...root.options].map((option) => [option.name, reportedSpelling(option)]),
);
process.stdout.write(`${JSON.stringify(reported)}\n`);
