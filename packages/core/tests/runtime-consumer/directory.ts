import { applicationDirectory } from '@loomcli/core';
import type { ApplicationDirectory, DirectoryLookup } from '@loomcli/core';

// The packed resolver, compiled against core's emitted declarations, prints each lookup as JSON:
// The state or cache directory row, then a relative HOME the darwin row needs, for each kind.
const kinds: readonly ApplicationDirectory[] = ['installation', 'logs', 'cache'];
const env = { XDG_CACHE_HOME: '/cache', XDG_STATE_HOME: '/state' };
const lookups: DirectoryLookup[] = kinds.flatMap((kind) => [
  applicationDirectory(kind, 'notes', { env, platform: 'linux' }),
  applicationDirectory(kind, 'notes', { env: { HOME: 'relative' }, platform: 'darwin' }),
]);
process.stdout.write(`${JSON.stringify(lookups)}\n`);
