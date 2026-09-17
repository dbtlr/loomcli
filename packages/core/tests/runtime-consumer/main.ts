import { Application, override } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import { helpPage } from '@loomcli/plugins/help/views';
import { loomTheme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';
import { versionLine } from '@loomcli/plugins/version/views';

/**
 * The packed-package runtime consumer. It declares one required argument and one option, installs
 * the packed help and version plugins, carries one value of each help descriptor, and overrides
 * both declared views the plugins publish, then prints a line derived from the argument and the
 * option. Declaration, parsing, plugin loading, view resolution, and output all run from the files
 * a registry consumer installs. The entry runs at module top level the way the examples run.
 */
const greeter = new Application('greeter', {
  description: 'Greet one subject.',
  extensions: [
    helpCommand({
      details: 'The greeting is printed before the subject.',
      examples: [{ command: 'world --greeting packed', note: 'The line this check compares.' }],
    }),
  ],
  plugins: [help(), version(), loomTheme()],
  version: '1.0.0',
  // Each override brands the packed plugin's own default, which it calls by reference.
  views: [
    override(helpPage, {
      render: (page, context) => `greeter help\n${helpPage.render(page, context)}`,
    }),
    override(versionLine, {
      render: (graph, context) => `greeter build\n${versionLine.render(graph, context)}`,
    }),
  ],
})
  .argument('subject', { description: 'Who to greet.', required: true })
  .option('greeting', {
    default: 'hello',
    description: 'The greeting to print.',
    extensions: [helpInput({ placeholder: 'word' })],
    short: 'g',
    type: 'string',
  })
  .action(({ args, options, out }) => out.print(`${options.greeting}: ${args.subject}`));

const styled = process.env.LOOM_PACKED_STYLES === '1';
await greeter.run({
  host: { env: {} },
  rendering: { color: styled ? 'always' : 'never', modifiers: styled ? 'always' : 'never' },
});
