import { Application, Command } from '../../dist/index.js';

const scenario = process.argv[2];
const base = new Command('export')
  .option('a', { type: 'boolean' })
  .option('b', { type: 'boolean' });
const cases = {
  'after-action': () => base.action(() => {}).exclusive('a', 'b'),
  argument: () => base.argument('file', {}).oneRequired('a', 'file'),
  conditional: () =>
    new Command('export')
      .option('a', { required: 'non-interactive', type: 'string' })
      .option('b', { type: 'boolean' })
      .exclusive('a', 'b'),
  content: () =>
    new Command('export')
      .option('a', { required: true, stdin: true, type: 'content' })
      .option('b', { type: 'boolean' })
      .exclusive('a', 'b'),
  global: () =>
    new Application('groups')
      .globalOption('global', { type: 'boolean' })
      .option('a', { type: 'boolean' })
      .oneRequired('a', 'global'),
  minimum: () =>
    new Command('export')
      .option('a', { min: 1, multiple: true, type: 'content' })
      .option('b', { type: 'boolean' })
      .exclusive('a', 'b'),
  overlap: () => base.exclusive('a', 'b').requiredTogether('a', 'b'),
  redundancy: () =>
    new Command('export')
      .option('a', { required: true, type: 'string' })
      .option('b', { type: 'boolean' })
      .oneRequired('a', 'b')
      .oneRequired('b', 'a'),
  repeat: () => base.exclusive('a', 'a'),
  required: () =>
    new Command('export')
      .option('a', { required: true, type: 'string' })
      .option('b', { type: 'boolean' })
      .exclusive('a', 'b'),
  'reverse-overlap': () => base.requiredTogether('a', 'b').exclusive('a', 'b'),
  short: () => base.oneRequired('a'),
  unknown: () => base.exclusive('a', 'missing'),
};
try {
  cases[scenario]();
  process.stdout.write('accepted\n');
} catch (error) {
  process.stdout.write(JSON.stringify({ message: error.message, name: error.name }));
}
