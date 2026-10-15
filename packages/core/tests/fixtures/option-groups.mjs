import { Application, Command } from '../../dist/index.js';

const [scenario, ...argv] = process.argv.slice(2);
const command = new Command('export', { description: 'Export a document.' })
  .option('json', { description: 'JSON output.', type: 'boolean' })
  .option('yaml', { description: 'YAML output.', type: 'boolean' });
const grouped = command[scenario]('json', 'yaml').action(({ out }) => out.print('action'));
process.exitCode = await new Application('groups', { description: 'Group probe.' })
  .command(grouped)
  .run({ host: { argv: ['export', ...argv], env: {} } });
