import { Application } from '@loom/core';

await new Application('shared-input-key')
  .argument('files', { required: true, variadic: true })
  .option('files', { type: 'boolean' })
  .action(({ args, options, out }) => out.print(JSON.stringify({ args, options })))
  .run();
