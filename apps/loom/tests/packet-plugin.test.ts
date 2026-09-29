import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import { packet } from '../src/build.js';
import type { PacketLoad } from '../src/build.js';
import { removeRoots, temporaryRoot } from './fixture.js';

/** The byte order mark some editors write at the start of a UTF-8 file. */
const byteOrderMark = '\uFEFF';

afterEach(() => {
  removeRoots();
});

/** What the plugin answers for one module, through the load callback whose filter matches it. */
function load(path: string) {
  const loaders: {
    filter: RegExp;
    callback: (args: PacketLoad) => Promise<{ contents: string }>;
  }[] = [];
  packet().setup({
    onLoad: (constraints, callback) => loaders.push({ callback, filter: constraints.filter }),
  });
  const loader = loaders.find(({ filter }) => filter.test(path));
  if (loader === undefined) {
    throw new Error(`No loader matches ${path}.`);
  }
  return loader.callback({ path });
}

test('a packet saved with a byte order mark reads as its members', async () => {
  const path = join(temporaryRoot('loom-packet-'), 'loom.packet.json');
  writeFileSync(path, `${byteOrderMark}{"build":"development"}\n`);
  const { contents } = await load(path);
  expect(contents).toBe('{"build":"distributed"}');
});

test('a Unicode table module with no data file read fails the build and names the module', async () => {
  const generated = join(
    temporaryRoot('loom-tables-'),
    'node_modules/@rockorager/uucode/dist/src/generated',
  );
  mkdirSync(generated, { recursive: true });
  const path = join(generated, 'runtime_grapheme.js');
  writeFileSync(path, 'export const table = [];\n');
  await expect(load(path)).rejects.toThrow(path);
});
