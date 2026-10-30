import { Application, Command, extension } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mcp } from '@loomcli/plugins/mcp';
import { mcpCommand, mcpInput } from '@loomcli/plugins/mcp/extension';

/** A binding another plugin owns, which might bind a configuration source. */
const foreignBinding = extension('@fixture/binding', {
  schema: {
    '~standard': { validate: (value) => ({ value }), vendor: 'fixture', version: 1 },
  },
  target: 'option',
});

const choice = (name, kind) => {
  const declaration = new Command(name, { description: 'Choose inputs.' })
    .option('flag', { description: 'Positive flag.', type: 'boolean' })
    .option('count', { description: 'Count occurrences.', type: 'count' })
    .option('items', { description: 'Collect items.', multiple: true, type: 'string' });
  return declaration[kind]('flag', 'count', 'items')
    .extend(mcpCommand({}))
    .action(({ out }) => out.print('action'));
};

const bound = new Command('bound', { description: 'Read bound inputs.' })
  .option('first', { description: 'First input.', env: 'GROUP_FIRST', type: 'string' })
  .option('second', { description: 'Second input.', type: 'string' })
  .oneRequired('first', 'second')
  .extend(mcpCommand({}))
  .action(() => {});
const described = new Command('described', { description: 'Read described inputs.' })
  .option('first', {
    description: 'First input.',
    extensions: [mcpInput({ description: 'Described input.' })],
    type: 'string',
  })
  .option('second', { description: 'Second input.', type: 'string' })
  .requiredTogether('first', 'second')
  .extend(mcpCommand({}))
  .action(() => {});
const extended = new Command('extended', { description: 'Read extended inputs.' })
  .option('first', {
    description: 'First input.',
    extensions: [foreignBinding('first')],
    type: 'string',
  })
  .option('second', { description: 'Second input.', type: 'string' })
  .requiredTogether('first', 'second')
  .extend(mcpCommand({}))
  .action(() => {});

const negated = new Command('negated', { description: 'Choose a format or no cache.' })
  .option('cache', { description: 'Skip the cache.', polarity: 'negative', type: 'boolean' })
  .option('json', { description: 'JSON output.', type: 'boolean' })
  .option('yaml', { description: 'YAML output.', type: 'boolean' })
  .exclusive('cache', 'json', 'yaml')
  .extend(mcpCommand({}))
  .action(() => {});

const excluding = [mcpInput({ exclude: true })];
const partial = new Command('partial', { description: 'Read partly excluded inputs.' })
  .option('message', { description: 'The message.', type: 'string' })
  .option('file', { description: 'The file.', extensions: excluding, type: 'string' })
  .option('left', { description: 'Left input.', type: 'string' })
  .option('right', { description: 'Right input.', type: 'string' })
  .option('far', { description: 'Far input.', extensions: excluding, type: 'string' })
  .oneRequired('message', 'file')
  .exclusive('left', 'right', 'far')
  .extend(mcpCommand({}))
  .action(({ out }) => out.print('action'));

const app = new Application('groups', {
  description: 'Export documents.',
  plugins: [help(), manifest(), completion(), mcp()],
})
  .option('json', {
    aliases: ['js'],
    description: 'JSON output.',
    polarity: 'both',
    type: 'boolean',
  })
  .option('yaml', { description: 'YAML output.', polarity: 'both', type: 'boolean' })
  .option('user', { description: 'User name.', type: 'string' })
  .option('password', { description: 'Password.', type: 'string' })
  .option('secret', { description: 'Hidden setting.', hidden: true, type: 'boolean' })
  .option('other', { description: 'Other setting.', type: 'boolean' })
  .exclusive('json', 'yaml')
  .oneRequired('json', 'yaml')
  .requiredTogether('user', 'password')
  .exclusive('secret', 'other')
  .extend(mcpCommand({}))
  .command(choice('choice', 'exclusive'))
  .command(choice('need', 'oneRequired'))
  .command(choice('together', 'requiredTogether'))
  .command(bound)
  .command(negated)
  .command(described)
  .command(extended)
  .command(partial)
  .action(({ out }) => out.print('action'));

process.exitCode = await app.run();
