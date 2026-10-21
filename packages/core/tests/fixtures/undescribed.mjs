import { Application, Command } from '@loomcli/core';

const release = { build: 'development' };

/** An Application, a Command, an option, and an argument, none of them described. */
const app = new Application('store').command(
  new Command('get')
    .argument('path', { required: true })
    .option('raw', { type: 'boolean' })
    .action(({ args, out }) => out.print(args.path)),
);

const code = await app.run({ host: { argv: ['get', 'name'], release } });
const outcome = await app.invoke(['get'], { args: { path: 'other' } }, { host: { release } });
process.stdout.write(
  `${JSON.stringify({ checked: app.check().length, code, invoked: outcome.status })}\n`,
);
