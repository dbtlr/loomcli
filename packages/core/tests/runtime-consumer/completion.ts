import { Application } from '@loomcli/core';
import type { Plugin } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';

// The packed completion plugin attaches its Command group and prints a shell's script.
const installed: Plugin = completion();

const app = new Application('packed-completion', { plugins: [installed] }).action(({ out }) =>
  out.print('root'),
);

await app.run({ host: { argv: process.argv.slice(2) } });
