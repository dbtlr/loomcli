import { applicationDirectory } from '@loomcli/core';
import type { ApplicationDirectory, DirectoryLookup } from '@loomcli/core';

// The packed resolver, compiled against core's emitted declarations, prints each lookup as JSON:
// The state directory row, then a relative HOME the darwin row needs, for each kind.
const kinds: readonly ApplicationDirectory[] = ['installation', 'logs'];
const lookups: DirectoryLookup[] = kinds.flatMap((kind) => [
  applicationDirectory(kind, 'notes', { env: { XDG_STATE_HOME: '/state' }, platform: 'linux' }),
  applicationDirectory(kind, 'notes', { env: { HOME: 'relative' }, platform: 'darwin' }),
]);
process.stdout.write(`${JSON.stringify(lookups)}\n`);
