import { readExtension } from '@loomcli/core';
import type { ChainOutcome, Middleware, OptionsOf, PluginOptionValues } from '@loomcli/core';

import type { help } from './plugin-entry.js';
import { helpCommand } from './plugin-extension.js';

// `Middleware<typeof help>` reads the declared options from the factory's annotated return type,
// And `OptionsOf` extracts the same record for a consumer that names it.
type Options = OptionsOf<typeof help>;

const middleware: Middleware<typeof help> = async ({ command, next, options, out }) => {
  const values: PluginOptionValues<Options> = options;
  const wanted: boolean = values.help;
  const facts = readExtension(command, helpCommand);
  const details: string | undefined = facts?.details;
  await out.print(details ?? command.name ?? 'the root Command');
  if (!wanted) {
    const outcome: ChainOutcome = await next();
    await out.info(outcome);
  }
};

export default middleware;
