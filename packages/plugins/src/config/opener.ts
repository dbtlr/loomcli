import type { Opener, StandardSchemaV1 } from '@loomcli/core';

import type { ConfigProvider } from './plugin.js';
import { loadOnce } from './shared.js';
import type { Shared } from './shared.js';

/**
 * The opener of the `config` provider: the schema's output for the file the run read, or for an
 * empty file when it found none. It shares the run's one read with the source.
 */
export function configOpener<Schema extends StandardSchemaV1, Directory extends string>(
  shared: Shared<Schema>,
): Opener<ConfigProvider<Schema, Directory>> {
  return async ({ graph, host, options, out, style }) => {
    // A provider is told no invocation by name, so a named file's failure here spells `--config`.
    const { output } = await loadOnce(shared, {
      graph,
      host,
      invokedBy: 'argv',
      options,
      out,
      style,
    });
    return output;
  };
}
