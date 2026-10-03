import { writeFileSync } from 'node:fs';
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

test('packet() answers the packet alone and leaves every other module to the bundler', () => {
  const filters: RegExp[] = [];
  packet().setup({ onLoad: ({ filter }) => filters.push(filter) });
  expect(filters).toHaveLength(1);
  expect(filters[0]?.test('/app/loom.packet.json')).toBe(true);
  expect(
    filters[0]?.test('/app/node_modules/@rockorager/uucode/dist/src/generated/runtime_width.js'),
  ).toBe(false);
});
