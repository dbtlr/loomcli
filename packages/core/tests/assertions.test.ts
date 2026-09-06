import { readdir, readFile } from 'node:fs/promises';

import { expect, test } from 'vite-plus/test';

const source = new URL('../src/', import.meta.url);

/** The seams where validated `unknown` values meet declaration-inferred types. Nothing else. */
const allowed = { 'globals.ts': 1, 'validation.ts': 1 };

/**
 * Any lint disable that would let an unsafe assertion through: one that names the rule, or one
 * that names no rule at all. Line and file scopes count alike.
 */
const disable = /(?:oxlint|eslint)-disable(?:-next-line|-line)?(?<rules>[^*\n]*)/u;

/** Compiler escapes are not assertions, but they bypass the same check, so none may appear. */
const escapes = /@ts-(?:ignore|expect-error|nocheck)/u;

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

function disablesAssertions(line: string) {
  const rules = disable.exec(line)?.groups?.rules?.trim() ?? null;
  return rules !== null && (rules === '' || rules.includes('no-unsafe-type-assertion'));
}

async function collectSites(): Promise<{ escapes: string[]; sites: Site[] }> {
  const found: Site[] = [];
  const escaped: string[] = [];
  const entries = await readdir(source, { recursive: true });
  for (const file of entries.filter((entry) => entry.endsWith('.ts'))) {
    const contents = await readFile(new URL(file, source), 'utf8');
    const lines = contents.split('\n');
    lines.forEach((line, index) => {
      if (disablesAssertions(line)) {
        found.push({ comment: commentAbove(lines, index), file, line: index + 1 });
      }
      if (escapes.test(line)) {
        escaped.push(`${file}:${index + 1}`);
      }
    });
  }
  return { escapes: escaped, sites: found };
}

test('every unsafe type assertion in core is a documented last resort', async () => {
  const { escapes: found, sites } = await collectSites();
  expect(found).toEqual([]);
  const counts: Record<string, number> = {};
  for (const site of sites) {
    counts[site.file] = (counts[site.file] ?? 0) + 1;
  }
  expect(counts).toEqual(allowed);
  const documented = sites.map((site) => ({
    holds: /it holds because/iu.test(site.comment),
    lastResort: /last resort/iu.test(site.comment),
    noTypedPath: /no typed path/iu.test(site.comment),
    where: `${site.file}:${site.line}`,
  }));
  expect(documented).toEqual(
    documented.map(({ where }) => ({ holds: true, lastResort: true, noTypedPath: true, where })),
  );
});
