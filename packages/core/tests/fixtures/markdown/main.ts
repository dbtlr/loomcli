import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';

import details from './details.md' with { type: 'text' };

/** The packed build inlines Markdown; neither runtime needs the source file. */
const app = new Application('markdown', {
  description: 'Read Markdown Details.',
  plugins: [help()],
})
  .extend(helpCommand({ details }))
  .action(() => {});

await app.run({
  host: { argv: process.argv.slice(2) },
  rendering: { color: 'never', modifiers: 'never' },
});
