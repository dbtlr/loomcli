import { Application, Command, plugin } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';

// A plugin compiles outside any Application's registration, so each of its Commands requires no globals.
// The list accepts a Command in every shape an application attaches.
const status = new Command('status', { description: 'Report the status.' })
  .alias('st')
  .argument('target', { required: true })
  .option('verbose', { type: 'boolean' })
  .result<{ healthy: boolean }>({
    views: { text: { render: (value) => `${String(value.healthy)}\n` } },
  })
  .action(({ args, options, out }) =>
    out.results({ healthy: args.target.length > 0 && !options.verbose }),
  );

const clear = new Command('clear').action(() => undefined);
const cache = new Command('cache').command(clear);

// @ts-expect-error TS2322: The list holds Command values alone.
plugin('consumer/strings', { commands: ['status'] });

export function clinic(): Plugin {
  return plugin('consumer/clinic', { commands: [status, cache] });
}

export const withClinic = new Application('consumer', { plugins: [clinic()] }).command(
  new Command('local').action(() => undefined),
);
