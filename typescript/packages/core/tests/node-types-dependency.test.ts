import { readdir, readFile } from 'node:fs/promises';

import { expect, test } from 'vite-plus/test';

/** Every package in the repository. */
const packages = new URL('../../', import.meta.url);

/**
 * A published package that lists `@types/node` under `dependencies` can make a package manager
 * hoist its exact copy over the consumer's own Node types. The declarations still import `node:`
 * modules, so a consumer type-checks them against the Node types it installed.
 */
test('no published package depends on @types/node', async () => {
  const listing: string[] = [];
  const entries = await readdir(packages, { withFileTypes: true });
  for (const entry of entries.filter((candidate) => candidate.isDirectory())) {
    const manifest = JSON.parse(
      await readFile(new URL(`${entry.name}/package.json`, packages), 'utf8'),
    );
    for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies']) {
      if (manifest.private !== true && manifest[field]?.['@types/node'] !== undefined) {
        listing.push(`${manifest.name} ${field}`);
      }
    }
  }
  expect(listing).toEqual([]);
});
