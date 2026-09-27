import { readExtension } from '@loomcli/core';
import type {
  ChainOutcome,
  Middleware,
  OptionsOf,
  PluginOptionSpellings,
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
  // A spelling is keyed by the plugin's own option names, and an option given no token has none.
  const spellings: PluginOptionSpellings<Options> = context.spellings;
  const spelled: string | undefined = spellings.help;
  // @ts-expect-error TS2339: A middleware reads the spellings of its own options alone.
  void spellings.file;
  const facts = readExtension(command, helpCommand);
  const details: string | undefined = facts?.details;
  // The request is untyped plain data, and the view is a name the middleware reads and assigns.
  const request: Request | null = context.request;
  const path: unknown = request?.args.path;
  const selected: string | null = context.view;
  await out.print(details ?? spelled ?? command.name ?? 'the root Command');
  if (!wanted) {
    context.view = selected ?? String(path);
    const outcome: ChainOutcome = await next();
    await out.info(outcome);
  }
};

export default middleware;
