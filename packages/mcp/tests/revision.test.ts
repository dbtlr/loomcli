import { readdir, readFile } from 'node:fs/promises';

import { expect, test } from 'vite-plus/test';

import { protocolRevision } from '../src/index.js';

test('exports the one pinned revision', () => {
  expect(protocolRevision).toBe('2026-07-28');
});

test('spells the revision in one place, so every check and answer reads the constant', async () => {
  const source = new URL('../src/', import.meta.url);
  const files = await readdir(source);
  const spelling = await Promise.all(
    files.map(async (file) => ({
      file,
      spells: await readFile(new URL(file, source), 'utf8').then((text) =>
        text.includes('2026-07-28'),
      ),
    })),
  );
  expect(spelling.filter(({ spells }) => spells).map(({ file }) => file)).toEqual(['revision.ts']);
});
