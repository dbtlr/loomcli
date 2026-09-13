import { Application, Command } from '@loomcli/core';
import { z } from 'zod';

// One name and one alias, three value shapes. The globals put -f beside every local -F.

const report =
  (command) =>
  ({ args, options, passthrough, out }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));

const select = new Command('select')
  .option('field', { multiple: true, short: 'F', type: 'string' })
  .action(report('select'));

const count = new Command('count')
  .option('field', { polarity: 'both', short: 'F', type: 'boolean' })
  .action(report('count'));

const set = new Command('set')
  .option('field', {
    short: 'F',
    type: 'string',
    validate: z.string().transform((value) => value.toUpperCase()),
  })
  .action(report('set'));

const cache = new Command('cache').command(set);

const app = new Application('spellings')
  .globalOption('file', { short: 'f', type: 'string' })
  .command(select)
  .command(count)
  .command(cache)
  .action(report('root'));

await app.run({ host: { argv: process.argv.slice(3) } });
