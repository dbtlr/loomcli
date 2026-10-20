import { Command } from '@loomcli/core';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { mcpCommand } from '@loomcli/plugins/mcp/extension';

import { maxDepth } from '../actions/max-depth.js';
import { documentInput } from '../document-input.js';
import { pathFailures, readFailures } from '../failures.js';

// `stats depth max` sits three levels below the root, so routing, help, completion, and every
// Projection jsonkit installs serve a path that deep.
const max = new Command('max', {
  description: 'Print the deepest nesting level under a path.',
  extensions: [
    manifestCommand({ failures: [...pathFailures, ...readFailures] }),
    helpCommand({ examples: [{ command: 'stats depth max user -f doc.json' }] }),
    mcpCommand({ annotations: { openWorld: false, readOnly: true } }),
  ],
})
  .option('file', documentInput)
  .argument('path', { description: 'Dot path to measure. Omit it for the root.' })
  .action(maxDepth);

const depth = new Command('depth', {
  description: 'Measure how deeply the document nests.',
}).command(max);

const stats = new Command('stats', {
  description: "Report facts about the document's shape.",
  extensions: [helpCommand({ section: ['Document commands', 'Read'] })],
}).command(depth);

export { max, stats };
