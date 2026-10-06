import { Application, Command, FatalError } from '@loomcli/core';
import { format, json } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

/** A validator that accepts decimal digits alone. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^\d+$/u.test(value) ? { value } : { issues: [{ message: 'Use decimal digits.' }] },
    vendor: 'fixture',
    version: 1,
  },
};

const table = { render: (data) => `table:${data.label}\n` };

/** Every scenario installs the pack in the order the examples do. */
const plugins = [help(), version(), format()];

/** A Command that fails as `--fail` names, after its own options validated. */
const count = new Command('count')
  .option('depth', { type: 'string', validate: digits })
  .option('fail', { type: 'string' })
  .result({ views: { table } })
  .action(({ options, out }) => {
    if (options.fail === 'controls') {
      throw new FatalError('A \u009b control and a "quote".');
    }
    if (options.fail !== undefined) {
      throw new FatalError('The count failed.');
    }
    return out.results({ label: 'a' });
  });

const scenarios = {
  /** A Command whose default view is `json()`, so a failure with no --format encodes. */
  'json-default': () =>
    new Application('app', { plugins }).command(
      new Command('count').result({ views: { json: json(), table } }).action(() => {
        throw new FatalError('The count failed.');
      }),
    ),
  plain: () => new Application('app', { plugins }).command(count),
  /** Terminal controls preserved, so a C1 control reaches the encoder, which escapes it. */
  preserve: () =>
    new Application('app', { plugins, rendering: { terminalControls: 'preserve' } }).command(count),
};

const [name, ...argv] = process.argv.slice(2);
process.exitCode = await scenarios[name]().run({ host: { argv } });
