import type { Opener, StandardSchemaV1 } from '@loomcli/core';

import type { ConfigProvider } from './plugin.js';
import { loadOnce } from './shared.js';
import type { Shared } from './shared.js';
import { strictFailure } from './strict.js';

/** No entry: the length of an empty list. */
const none = 0;

/**
 * The opener of the `config` provider: the schema's output for the file the run read, or for an
 * empty file when it found none. It shares the run's one read with the source. A read that held a
 * value or key `strict` covers fails the run instead.
 */
export function configOpener<Schema extends StandardSchemaV1, Directory extends string>(
  shared: Shared<Schema>,
): Opener<ConfigProvider<Schema, Directory>> {
  return async ({ graph, host, invokedBy, log, options, out, style }) => {
    const { held, output } = await loadOnce(shared, {
      graph,
      host,
      invokedBy,
      log,
      options,
      out,
      style,
    });
    if (held.length > none) {
      throw strictFailure(held, [], invokedBy);
    }
    return output;
  };
}
