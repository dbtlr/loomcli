import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, expect, test } from 'vite-plus/test';

import {
  checkLinks,
  collectAnchors,
  extractLinks,
  formatBroken,
  slugify,
} from '../../../scripts/check-links.mjs';

/** The temporary documentation trees this file built, removed after each test. */
const trees: string[] = [];

afterEach(() => {
  for (const directory of trees.splice(0)) {
    rmSync(directory, { force: true, recursive: true });
  }
});

/** A temporary tree holding the given files, by path from its root. */
function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'loom-links-'));
  trees.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

/** The broken links `checkLinks()` reports over every Markdown file in a tree, as printed. */
function broken(files: Record<string, string>): string[] {
  return formatBroken(checkLinks(tree(files), Object.keys(files)));
}

test('a link to a file that does not exist is reported with its line', () => {
  expect(broken({ 'a.md': '# A\n\nSee [b](b.md).\n' })).toEqual(['a.md:3: b.md: no such file']);
});

test('a link to a file or a directory that exists is not reported', () => {
  expect(broken({ 'a.md': '[b](docs/b.md) [d](docs/)', 'docs/b.md': '# B' })).toEqual([]);
});

test('a relative link resolves against the directory of the file that holds it', () => {
  const files = { 'docs/a.md': '[up](../top.md) [side](b.md)', 'docs/b.md': '', 'top.md': '' };
  expect(broken(files)).toEqual([]);
});

test('a link whose anchor no heading makes is reported', () => {
  const files = { 'a.md': '[b](b.md#nowhere)', 'b.md': '# Somewhere\n' };
  expect(broken(files)).toEqual(['a.md:1: b.md#nowhere: no such anchor']);
});

test('a link to the slug of a heading resolves', () => {
  const files = {
    'a.md': '[b](b.md#the-core_reference-12)',
    'b.md': '## The `core_reference` 1.2!\n',
  };
  expect(broken(files)).toEqual([]);
});

test('a repeated heading gets -1, -2 in document order', () => {
  const text = '# Same\n\n## Same\n\n## Same\n';
  expect([...collectAnchors(text)]).toEqual(['same', 'same-1', 'same-2']);
  const files = { 'a.md': '[x](b.md#same-2) [y](b.md#same-3)', 'b.md': text };
  expect(broken(files)).toEqual(['a.md:1: b.md#same-3: no such anchor']);
});

test('a heading inside a code fence makes no anchor', () => {
  const text = '```md\n# Hidden\n```\n\n~~~~\n## Also hidden\n~~~~\n\n# Shown\n';
  expect([...collectAnchors(text)]).toEqual(['shown']);
});

test('an explicit HTML anchor makes an anchor', () => {
  const text = '<a id="by-id"></a>\n<a name="by-name"></a>\n';
  expect([...collectAnchors(text)]).toEqual(['by-id', 'by-name']);
});

test('slugs keep Unicode letters and drop punctuation', () => {
  expect(slugify('Über den Fluß: a (b) c_d - e')).toBe('über-den-fluß-a-b-c_d---e');
});

test('a bare anchor is checked against the same file', () => {
  expect(broken({ 'a.md': '# Top\n\n[ok](#top) [bad](#bottom)\n' })).toEqual([
    'a.md:3: #bottom: no such anchor',
  ]);
});

test('an anchor on a file that is not Markdown only needs the file', () => {
  expect(broken({ 'a.md': '[code](src/x.ts#L10)', 'src/x.ts': '' })).toEqual([]);
});

test('a link inside a code fence, an inline code span, or frontmatter is ignored', () => {
  const text = [
    '---',
    'see: [front](gone.md)',
    '---',
    '',
    '- item',
    '',
    '  ```md',
    '  [fenced](gone.md)',
    '  ```',
    '',
    '````',
    '```',
    '[longer](gone.md)',
    '````',
    '',
    'Inline `[coded](gone.md)` and ``[double](gone.md) ` tick``.',
    '',
    '[real](gone.md)',
  ].join('\n');
  expect(broken({ 'a.md': text })).toEqual(['a.md:18: gone.md: no such file']);
});

test('an external or protocol-relative link is ignored', () => {
  const text =
    '[a](https://example.com/x) [b](mailto:a@b.c) [c](//cdn.example.com/x) ![d](http://e.f/g.png)';
  expect(broken({ 'a.md': text })).toEqual([]);
});

test('a reference definition is checked', () => {
  const text = '[label][ref]\n\n[ref]: missing.md "Title"\n[ok]: <b.md>\n[^note]: not a link\n';
  expect(broken({ 'a.md': text, 'b.md': '' })).toEqual(['a.md:3: missing.md: no such file']);
});

test('an image is checked like a link', () => {
  expect(broken({ 'a.md': '![alt](pic.png)' })).toEqual(['a.md:1: pic.png: no such file']);
});

test('a title, angle brackets, a query, and percent escapes are stripped', () => {
  const files = {
    'a.md': '[a](<b c.md> "t") [b](b%20c.md?raw=1) [c](b%20c.md#top \'t\')',
    'b c.md': '# Top\n',
  };
  expect(broken(files)).toEqual([]);
});

test('a link text that wraps across lines still finds its target', () => {
  expect(extractLinks('A [long\ntext](gone.md) here').map((link) => link.target)).toEqual([
    'gone.md',
  ]);
});

test('a root-relative path resolves against the root', () => {
  expect(broken({ 'docs/a.md': '[b](/top.md)', 'top.md': '' })).toEqual([]);
});

test('a change fragment links relative to the repository root', () => {
  const files = { '.changes/fix.md': '- Fix [core](docs/core.md).', 'docs/core.md': '' };
  expect(broken(files)).toEqual([]);
});
