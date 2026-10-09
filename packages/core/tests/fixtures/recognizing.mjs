import { Application, Command, plugin } from '@loomcli/core';

// Prints, for each value, whether `instanceof Application` recognizes it.

/** A plugin the Application installs, so a constructed value carries its globals. */
const installed = plugin('@fixture/recognizing', {});

/** A result view that prints its value, which `result()`, `rows()`, and `views()` take. */
const text = { render: () => 'value\n' };
const row = { row: () => 'row\n' };

const bare = new Application('probe', { description: 'Probe recognition.' });
const withPlugin = new Application('probe', { description: 'Probe.', plugins: [installed] });
const child = new Command('child', { description: 'A child.' }).action(() => undefined);

const values = {
  aCommand: child,
  aFunction: () => bare,
  aNull: null,
  aPlainObject: { name: 'probe' },
  aPrototypeCopy: { ...bare },
  action: bare.action(() => undefined),
  argument: bare.argument('subject', { description: 'The subject.' }),
  bare,
  chained: bare
    .globalOption('trace', { description: 'Trace.', type: 'boolean' })
    .option('limit', { description: 'The limit.', type: 'string' })
    .action(() => undefined),
  command: bare.command(child),
  extend: bare.extend(),
  globalOption: bare.globalOption('trace', { description: 'Trace.', type: 'boolean' }),
  option: bare.option('limit', { description: 'The limit.', type: 'string' }),
  plugins: withPlugin.action(() => undefined),
  result: bare.result({ views: { text } }),
  rows: bare.rows({ views: { text: row } }),
  unconfigured: new Application('probe'),
  views: bare.result({ views: { text } }).views({ text }),
};

const recognized = Object.entries(values).map(([name, value]) => [
  name,
  value instanceof Application,
]);
process.stdout.write(`${JSON.stringify(Object.fromEntries(recognized))}\n`);
