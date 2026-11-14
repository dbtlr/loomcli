import { Command } from '@loomcli/core';

// The declaration loads its handler only when it runs, as the Commands reference shows.
// The handler type-imports this declaration back, and the inline handler infers without a cycle.
const fetch = new Command('fetch')
  .argument('path', { required: true })
  .option('raw', { type: 'boolean' })
  .action(async (context) => {
    const { fetchValue } = await import('./lazy-value.js');
    return fetchValue(context);
  });

export { fetch };
