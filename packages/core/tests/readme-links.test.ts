import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { pinLinks, repositoryLinks, unpinLinks } from '../../../scripts/readme-links.mjs';

const packages = fileURLToPath(new URL('../../', import.meta.url));

/** A published package's directory name and the manifest fields this file reads. */
interface PublishedPackage {
  readonly directory: string;
  readonly scripts: Readonly<Record<string, unknown>>;
}

/** Every package under `packages/` that npm publishes, so every one whose README reaches npm. */
function publishedPackages(): PublishedPackage[] {
  return readdirSync(packages).flatMap((directory) => {
    const manifest: unknown = JSON.parse(
      readFileSync(join(packages, directory, 'package.json'), 'utf8'),
    );
    if (typeof manifest !== 'object' || manifest === null) {
      throw new Error(`packages/${directory}/package.json is not an object.`);
    }
    if ('private' in manifest && manifest.private === true) {
      return [];
    }
    const scripts = 'scripts' in manifest ? manifest.scripts : undefined;
    return [
      {
        directory,
        scripts: typeof scripts === 'object' && scripts !== null ? { ...scripts } : {},
      },
    ];
  });
}

const readme = [
  '# @loomcli/example',
  '',
  'See the [reference](https://github.com/dbtlr/loomcli/blob/main/docs/core/README.md) and the',
  '[help plugin](https://github.com/dbtlr/loomcli/blob/main/docs/plugins/help.md#pager).',
  'The [repository](https://github.com/dbtlr/loomcli) and [npm](https://www.npmjs.com) stay as they are.',
  '',
].join('\n');

test('pinning points every docs link at the version tag and leaves every other byte alone', () => {
  expect(pinLinks(readme, '0.19.0')).toBe(
    readme.replaceAll(
      'https://github.com/dbtlr/loomcli/blob/main/',
      'https://github.com/dbtlr/loomcli/blob/v0.19.0/',
    ),
  );
});

test('a pinned link names the tag, and no link names main', () => {
  const pinned = pinLinks(readme, '1.2.0-next.3');
  expect(repositoryLinks(pinned)).toEqual([
    'https://github.com/dbtlr/loomcli/blob/v1.2.0-next.3/docs/core/README.md',
    'https://github.com/dbtlr/loomcli/blob/v1.2.0-next.3/docs/plugins/help.md#pager',
  ]);
});

test('unpinning a pinned README gives back the source README exactly', () => {
  expect(unpinLinks(pinLinks(readme, '0.19.0'), '0.19.0')).toBe(readme);
});

// Unpinning reverses the pin, so a source README that already named a tag would lose it at pack.
// A pack that fails before postpack leaves its README pinned, and this test then names the file.
test.each(publishedPackages().map(({ directory }) => directory))(
  'packages/%s/README.md links into the repository only through blob/main',
  (directory) => {
    const text = readFileSync(join(packages, directory, 'README.md'), 'utf8');
    const links = repositoryLinks(text);
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toMatch(/^https:\/\/github\.com\/dbtlr\/loomcli\/blob\/main\//u);
    }
  },
);

test.each(publishedPackages())(
  'packages/$directory pins its README links at pack and restores them after',
  ({ scripts }) => {
    expect({ postpack: scripts.postpack, prepack: scripts.prepack }).toEqual({
      postpack: 'node ../../scripts/readme-links.mjs unpin',
      prepack: 'node ../../scripts/readme-links.mjs pin',
    });
  },
);
