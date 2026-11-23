import { Application, processHandle, style } from '@loomcli/core';
import type { Background, Plugin } from '@loomcli/core';
import { background } from '@loomcli/plugins/background';
import type { BackgroundOptions } from '@loomcli/plugins/background';
import { theme } from '@loomcli/plugins/theme';

// The packed background plugin gives the operator --background, which core reads from argv.
const installed: Plugin<BackgroundOptions> = background();
const accent = style.adaptive({ dark: style.blue, light: style.red });

const app = new Application('packed-background', {
  plugins: [theme({ accent }), installed],
}).action(({ host, out }) => {
  const settled: Background | undefined = host.terminal.background;
  return out.print(String(settled));
});

// Piped output has no terminal to query, so only the operator's choice settles the background.
await app.run({
  process: processHandle({ argv: process.argv.slice(2), env: {} }),
});
