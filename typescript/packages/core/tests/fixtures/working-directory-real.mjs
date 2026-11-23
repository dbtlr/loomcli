import { Application } from '@loomcli/core';

// The run uses the real process, whose working directory the test removed before this file started.
await new Application('cwd', { description: 'The working directory application.' })
  .action(({ host, out }) => out.print(host.cwd))
  .run();
