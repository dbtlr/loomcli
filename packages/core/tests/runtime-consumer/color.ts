import { Application } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { color } from '@loomcli/plugins/color';
import type { ColorOptions } from '@loomcli/plugins/color';

// The packed color plugin gives the operator --color and --no-color, which core reads from argv.
const installed: Plugin<ColorOptions> = color();

const app = new Application('packed-color', { plugins: [installed] }).action(({ out, style }) =>
  out.print(style.red('red')),
);

// No variable speaks for color, so only the operator's choice turns it on for piped output.
await app.run({
  host: { argv: process.argv.slice(2), env: {}, release: { build: 'distributed' } },
});
