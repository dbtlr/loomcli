import { Application } from '@loomcli/core';

/**
 * The packed-package runtime consumer. It declares one required argument and one option, then
 * prints a line derived from both, so declaration, parsing, and output all run from the files a
 * registry consumer installs. The entry runs at module top level the way the examples run.
 */
const greeter = new Application('greeter')
  .argument('subject', { required: true })
  .option('greeting', { default: 'hello', short: 'g', type: 'string' })
  .action(({ args, options, out }) => out.print(`${options.greeting}: ${args.subject}`));

await greeter.run();
