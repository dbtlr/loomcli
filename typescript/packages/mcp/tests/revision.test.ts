// Acceptance plan: see packages/mcp/tests/framing.test.ts.
import { readdir, readFile } from 'node:fs/promises';

import { expect, test } from 'vite-plus/test';

import { handshakeRevisions, protocolRevision } from '../src/index.js';

test('exports the per-request revision and the initialize-era revisions, latest first', () => {
  expect(protocolRevision).toBe('2026-07-28');
  expect(handshakeRevisions).toEqual(['2025-11-25', '2025-06-18']);
});

test('spells each revision in one place, so every check and answer reads the constants', async () => {
  const source = new URL('../src/', import.meta.url);
  const files = await readdir(source);
  const spelling = await Promise.all(
    files.map(async (file) => ({
      file,
      spells: await readFile(new URL(file, source), 'utf8').then((text) =>
        ['2026-07-28', '2025-11-25', '2025-06-18'].some((revision) => text.includes(revision)),
      ),
    })),
  );
  expect(spelling.filter(({ spells }) => spells).map(({ file }) => file)).toEqual(['revision.ts']);
});
