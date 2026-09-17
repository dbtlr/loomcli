import { readExtension } from '@loomcli/core';
import type {
  ChainOutcome,
  Middleware,
  OptionsOf,
  PluginOptionValues,
  Request,
} from '@loomcli/core';

import type { help } from './plugin-entry.js';
import { helpCommand } from './plugin-extension.js';

// `Middleware<typeof help>` reads the declared options from the factory's annotated return type,
// And `OptionsOf` extracts the same record for a consumer that names it.
type Options = OptionsOf<typeof help>;

const middleware: Middleware<typeof help> = async (context) => {
  const { command, next, options, out } = context;
  const values: PluginOptionValues<Options> = options;
  const wanted: boolean = values.help;
  const facts = readExtension(command, helpCommand);
  const details: string | undefined = facts?.details;
  // The request is untyped plain data, and the view is a name the middleware reads and assigns.
  const request: Request | null = context.request;
  const path: unknown = request?.args.path;
  const selected: string | null = context.view;
  await out.print(details ?? command.name ?? 'the root Command');
  if (!wanted) {
    context.view = selected ?? String(path);
    const outcome: ChainOutcome = await next();
    await out.info(outcome);
  }
};

export default middleware;
