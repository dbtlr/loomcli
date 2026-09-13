import { Application, Command, DeclarationError } from '@loomcli/core';

const base = new Application('example').globalOption('quiet', { type: 'boolean' });
const action = ({ options, out }) => out.print(JSON.stringify(options));
const scenario = process.argv[2];
const scenarios = {
  'after-action': () => base.action(action).globalOption('late', { type: 'boolean' }),
  'after-command': () =>
    base.command(new Command('read').action(action)).globalOption('late', { type: 'boolean' }),
  derived: () => base.globalOption('limit', { default: '10', type: 'string' }).action(action),
  'local-first': () =>
    new Application('example')
      .option('quiet', { type: 'boolean' })
      .globalOption('quiet', { type: 'boolean' })
      .action(action),
  original: () => base.action(action),
};
const app = scenarios[scenario]();
if (process.argv[3] === 'inspect') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    process.stdout.write(`${error.message}\n`);
  }
} else {
  process.exitCode = await app.run({ host: { argv: [] } });
}
