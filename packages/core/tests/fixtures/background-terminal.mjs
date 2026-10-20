import { Application, style } from '@loomcli/core';
import { theme } from '@loomcli/plugins/theme';

/**
 * An application whose theme adapts, run on a real terminal. It prints the settled background and
 * the typeahead the query pushed back onto stdin, and then it ends.
 */
const accent = style.adaptive({ dark: style.blue, light: style.yellow });
const app = new Application('shade', {
  description: 'Print the settled background.',
  plugins: [theme({ accent })],
}).action(async ({ host, out }) => {
  // Only typeahead the query pushed back is read, so the action never waits on the terminal.
  // A bare data listener with no resume() call receives it, because the query leaves stdin's flowing state as it found it.
  const typeahead =
    host.stdin.readableLength === 0
      ? ''
      : await new Promise((resolve) => {
          host.stdin.once('data', (chunk) => {
            host.stdin.pause();
            resolve(String(chunk));
          });
        });
  await out.print(`background=${host.terminal.background ?? 'undefined'} typeahead=[${typeahead}]`);
});

await app.run();
