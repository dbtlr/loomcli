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

// The pin rewrites only blob/main/, so the guards must see every other way a README links in.
test.each([
  [
    'a relative link',
    '[example](../../examples/textstat/README.md)',
    '../../examples/textstat/README.md',
  ],
  [
    'a folder on main',
    '[docs](https://github.com/dbtlr/loomcli/tree/main/docs)',
    'https://github.com/dbtlr/loomcli/tree/main/docs',
  ],
  [
    'a raw file on main',
    '![diagram](https://github.com/dbtlr/loomcli/raw/main/docs/x.svg)',
    'https://github.com/dbtlr/loomcli/raw/main/docs/x.svg',
  ],
  [
    'a raw.githubusercontent.com file',
    '![diagram](https://raw.githubusercontent.com/dbtlr/loomcli/main/docs/x.svg)',
    'https://raw.githubusercontent.com/dbtlr/loomcli/main/docs/x.svg',
  ],
  [
    'an http link',
    '[core](http://github.com/dbtlr/loomcli/blob/main/docs/core/README.md)',
    'http://github.com/dbtlr/loomcli/blob/main/docs/core/README.md',
  ],
  [
    'a www link',
    '[core](https://www.github.com/dbtlr/loomcli/blob/main/docs/core/README.md)',
    'https://www.github.com/dbtlr/loomcli/blob/main/docs/core/README.md',
  ],
  [
    'a protocol-relative link',
    '[core](//github.com/dbtlr/loomcli/blob/main/docs/core/README.md)',
    '//github.com/dbtlr/loomcli/blob/main/docs/core/README.md',
  ],
  [
    'a bare URL',
    'Read https://github.com/dbtlr/loomcli/blob/main/docs/core/README.md first.',
    'https://github.com/dbtlr/loomcli/blob/main/docs/core/README.md',
  ],
  [
    'an HTML image with a relative source',
    '<img src="../../examples/textstat/diagram.svg" width="480">',
    '../../examples/textstat/diagram.svg',
  ],
  [
    'an HTML anchor with a relative target',
    "<a href='../../examples/textstat/README.md'>example</a>",
    '../../examples/textstat/README.md',
  ],
  [
    'an HTML anchor with an absolute target',
    '<a href="https://github.com/dbtlr/loomcli/tree/main/examples">examples</a>',
    'https://github.com/dbtlr/loomcli/tree/main/examples',
  ],
])('%s into the repository is a repository link', (_form, text, link) => {
  expect(repositoryLinks(text)).toEqual([link]);
});

test('an anchor, an external page, and the repository home are not repository links', () => {
  expect(
    repositoryLinks(
      '[top](#install), [npm](https://www.npmjs.com), [repo](https://github.com/dbtlr/loomcli). <a href="#usage">Usage</a>',
    ),
  ).toEqual([]);
});

test('HTML shown in a code block or a code span is not a repository link', () => {
  expect(
    repositoryLinks(
      [
        '```html',
        '<img src="../../examples/textstat/diagram.svg">',
        '```',
        '',
        'Write `<a href="./x.md">`.',
      ].join('\n'),
    ),
  ).toEqual([]);
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
