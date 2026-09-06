import { readdir, readFile } from 'node:fs/promises';
import { basename } from 'node:path';

import { expect, test } from 'vite-plus/test';

const directive = 'oxlint-disable-next-line typescript/no-unsafe-type-assertion';
const source = new URL('../src/', import.meta.url);

/** The seams where validated `unknown` values meet declaration-inferred types. Nothing else. */
const allowed = { 'globals.ts': 1, 'validation.ts': 1 };

interface Site {
  file: string;
  line: number;
  comment: string;
}

/** The comment block above a directive, so the justification reads without opening the file. */
function commentAbove(lines: string[], index: number) {
  const block: string[] = [];
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const text = lines[cursor]?.trim() ?? '';
    if (!text.startsWith('//') && !text.startsWith('*') && !text.startsWith('/*')) {
      break;
    }
    block.unshift(text);
  }
  return block.join('\n');
}

async function collectSites(): Promise<Site[]> {
  const sites: Site[] = [];
  const entries = await readdir(source);
  for (const file of entries.filter((entry) => entry.endsWith('.ts'))) {
    const contents = await readFile(new URL(file, source), 'utf8');
    const lines = contents.split('\n');
    lines.forEach((line, index) => {
      if (line.includes(directive)) {
        sites.push({ comment: commentAbove(lines, index), file: basename(file), line: index + 1 });
      }
    });
  }
  return sites;
}

test('every unsafe type assertion in core is a documented last resort', async () => {
  const sites = await collectSites();
  const counts: Record<string, number> = {};
  for (const site of sites) {
    counts[site.file] = (counts[site.file] ?? 0) + 1;
  }
  expect(counts).toEqual(allowed);
  for (const site of sites) {
    expect(site.comment, `${site.file}:${site.line}`).toMatch(/last resort/iu);
  }
});
