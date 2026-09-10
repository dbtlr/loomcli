import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import { version } from '@loomcli/plugins/version';

/**
 * The packed-package runtime consumer. It declares one required argument and one option, installs
 * the packed help and version plugins, and carries one value of each help descriptor, then prints a
 * line derived from the argument and the option. Declaration, parsing, plugin loading, and output
 * all run from the files a registry consumer installs. The entry runs at module top level the way
 * the examples run.
 */
const greeter = new Application('greeter', {
  description: 'Greet one subject.',
  extensions: [
    helpCommand({
      details: 'The greeting is printed before the subject.',
      examples: [{ command: 'world --greeting packed', note: 'The line this check compares.' }],
    }),
  ],
  plugins: [help(), version()],
  version: '1.0.0',
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

await greeter.run();
