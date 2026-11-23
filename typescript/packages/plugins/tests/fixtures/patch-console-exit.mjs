import { Application, processHandle } from '@loomcli/core';
import { patchConsole } from '@loomcli/plugins/patch-console';

/**
 * A dependency that reports an error through `console.error` and exits at once while a frame is
 * drawn, on the real process: the patch-console plugin routes the message onto `out`, and core
 * writes it at the process's exit event.
 */
await new Application('ship', { plugins: [patchConsole()] })
  .action(async ({ out }) => {
    await out.region().draw('WORKING-FRAME', { render: (text) => text });
    console.error('CONSOLE-MESSAGE');
    process.exit(1);
  })
  .run({ process: processHandle({ argv: [] }) });
