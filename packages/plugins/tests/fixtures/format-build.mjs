import { Application, Command, plugin } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';

const dispatch = ({ out }) => out.print('dispatched');

const table = { render: () => 'table\n' };

/** A Command whose result carries one view, so the hook has something to reshape. */
function withResult(command) {
  return command.result({ views: { table } });
}

/** A plugin whose own option is named "format", installed ahead of format() in every scenario. */
const claimant = plugin('@fixture/claimant', {
  options: { format: { description: 'Claim the name first.', type: 'boolean' } },
});

const scenarios = {
  /** A global option "format" on the Application, which every Command's hook sees. */
  'global-collision': () => {
    const count = withResult(new Command('count')).action(dispatch);
    return new Application('app', { plugins: [format()] })
      .globalOption('format', { type: 'boolean' })
      .command(count)
      .action(dispatch);
  },
  /** A local option "format" on the Command the hook would otherwise reshape. */
  'local-collision': () => {
    const count = withResult(new Command('count').option('format', { type: 'boolean' })).action(
      dispatch,
    );
    return new Application('app', { plugins: [format()] }).command(count).action(dispatch);
  },
  /** Another plugin's own option "format", installed ahead of format(). */
  'plugin-collision': () => {
    const count = withResult(new Command('count')).action(dispatch);
    return new Application('app', { plugins: [claimant, format()] })
      .command(count)
      .action(dispatch);
  },
};

const [name, ...argv] = process.argv.slice(2);

process.exitCode = await scenarios[name]().run({ host: { argv } });
