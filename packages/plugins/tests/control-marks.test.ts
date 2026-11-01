/*
 * Acceptance plan for the first-party control marks (docs/core/commands.md#control-options).
 *
 * - A fixture application installs the first-party plugins that declare an option, and `inspect()`
 *   reads `control: true` on `--help`, `--version`, `--manifest`, `--color`, `--verbose`,
 *   `--quiet`, `--config`, and the `--format` the formatter's hook declares on a Command with a
 *   result, and `control: false` on the fixture's own work options.
 * - The core rules for a control option, and the fixture marks of each declarer, are proven in
 *   packages/core/tests/control-options.test.ts.
 */
import { Application, Command } from '@loomcli/core';
import { color } from '@loomcli/plugins/color';
import { configuration } from '@loomcli/plugins/config';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { verbose } from '@loomcli/plugins/verbose';
import { version } from '@loomcli/plugins/version';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/** An application with one plugin of each kind that declares an option, and two work options. */
function marked() {
  const read = new Command('read', { description: 'Read a value.' })
    .option('field', { description: 'The field to read.', type: 'string' })
    .result<string>({ views: { text: { render: (value) => `${value}\n` } } })
    .action(({ out }) => out.results('value'));
  return new Application('kit', {
    plugins: [
      help(),
      version(),
      format(),
      manifest(),
      configuration({ schema: z.object({}) }).plugin,
      color(),
      verbose(),
    ],
    version: '1.0.0',
  })
    .globalOption('file', { description: 'The document.', type: 'string' })
    .command(read)
    .action(() => {});
}

/** Each option the graph holds, by name, with whether it is a control. */
function controls() {
  const graph = marked().inspect();
  const read = graph.root.children.find((child) => child.name === 'read');
  const options = [...graph.globals, ...graph.root.options, ...(read?.options ?? [])];
  return Object.fromEntries(options.map((option) => [option.name, option.control]));
}

test('the first-party plugins mark their options as controls, and a work option reads false', () => {
  expect(controls()).toMatchObject({
    color: true,
    config: true,
    field: false,
    file: false,
    format: true,
    help: true,
    manifest: true,
    quiet: true,
    verbose: true,
    version: true,
  });
});
