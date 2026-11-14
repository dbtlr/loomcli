/*
 * Acceptance plan for the authoring skill's content module (docs/decisions/0149-...).
 *
 * - It lists every file under the skill folder, `SKILL.md` and each reference, read from the folder
 *   beside the module.
 * - A link to a file outside the skill folder renders as `https://github.com/dbtlr/loomcli/blob/v<version>/<path>`
 *   with its `#fragment`, for an inline link, an image, and a reference definition. A link between the
 *   skill's own files, an absolute URL, an anchor, a link in fenced code, an inline code span, or
 *   the frontmatter stays as written.
 * - The repository the links name is the one `package.json` names.
 * - `SKILL.md` renders with two blank lines after its frontmatter and a reference with a blank
 *   first line, so init's header lands between blank lines.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

import { extractLinks } from '../../../scripts/check-links.mjs';
import { authoringSkill, renderSkillLinks, repositoryUrl } from '../src/content/authoring-skill.js';
import { readManaged, renderManaged } from '../src/helpers/managed.js';

const tag = `${repositoryUrl}/blob/v0.19.0`;

test('the repository the links name is the one package.json names', () => {
  const manifest: unknown = JSON.parse(
    readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
  );
  const url =
    typeof manifest === 'object' && manifest !== null && 'repository' in manifest
      ? JSON.stringify(manifest.repository)
      : '';
  expect(url).toContain(`${repositoryUrl.replace('https://', '')}.git`);
});

test('it lists every file under the skill folder', () => {
  const folder = fileURLToPath(new URL('../skills/loom/', import.meta.url));
  const expected = [
    'SKILL.md',
    ...readdirSync(`${folder}references`).map((name) => `references/${name}`),
  ].toSorted();
  expect(authoringSkill('0.19.0').map(({ path }) => path)).toEqual(expected);
  expect(expected).toHaveLength(7);
});

test('a link outside the skill folder renders at the version tag, keeping its fragment', () => {
  const text = [
    'See [the page](../../../../../docs/libs/testing.md#mockprocess) and ![a](../../../../../docs/a.png).',
    '',
    '[ref]: ../../../../../docs/glossary.md#toolchain',
    '[angled]: <../../../../../docs/b.md>',
    'A wrapped [link',
    'text](../../../../../docs/c.md "Title") ends.',
  ].join('\n');
  expect(renderSkillLinks(text, 'references/testing.md', '0.19.0')).toBe(
    [
      `See [the page](${tag}/docs/libs/testing.md#mockprocess) and ![a](${tag}/docs/a.png).`,
      '',
      `[ref]: ${tag}/docs/glossary.md#toolchain`,
      `[angled]: <${tag}/docs/b.md>`,
      'A wrapped [link',
      `text](${tag}/docs/c.md "Title") ends.`,
    ].join('\n'),
  );
});

test('the skill folder is resolved from the source file, so SKILL.md reaches the repository one level up', () => {
  expect(renderSkillLinks('[x](../../../../docs/a.md)', 'SKILL.md', '0.19.0')).toBe(
    `[x](${tag}/docs/a.md)`,
  );
});

test('links within the skill, absolute URLs, anchors, code, and frontmatter stay as written', () => {
  const text = [
    '---',
    'description: "[x](../../../../../docs/a.md)"',
    '---',
    '',
    '[own](structure.md#a) [sibling](../SKILL.md) [url](https://example.com/a) [anchor](#top)',
    '`[code](../../../../../docs/a.md)`',
    '',
    '```md',
    '[fenced](../../../../../docs/a.md)',
    '```',
  ].join('\n');
  expect(renderSkillLinks(text, 'references/testing.md', '0.19.0')).toBe(text);
});

test('line endings are kept', () => {
  expect(renderSkillLinks('[x](../../../../../docs/a.md)\r\n', 'references/a.md', '0.19.0')).toBe(
    `[x](${tag}/docs/a.md)\r\n`,
  );
});

test('every rendered file carries no link into the repository that is not at the tag', () => {
  for (const { content } of authoringSkill('0.19.0')) {
    expect(content).not.toMatch(/\]\((?:\.\.\/)+docs\//u);
  }
});

test('SKILL.md and each reference take a header between blank lines', () => {
  for (const { content, path } of authoringSkill('0.19.0')) {
    const rendered = renderManaged(content);
    expect(readManaged(rendered)?.content).toBe(content);
    const lines = rendered.split('\n');
    const header = lines.findIndex((line) => line.startsWith('<!-- Managed by loom init.'));
    // SKILL.md's header follows its frontmatter, and a reference's header is its first line.
    expect(lines.slice(Math.max(0, header - 2), header)).toEqual(
      path === 'SKILL.md' ? ['---', ''] : [],
    );
    expect(header).toBe(path === 'SKILL.md' ? lines.indexOf('---', 1) + 2 : 0);
    expect(lines[header + 1]).toBe('');
    expect(lines[header + 2]).toMatch(/^# /u);
  }
});

test('init rewrites the links the repository link check reads, no more and no fewer', () => {
  const folder = fileURLToPath(new URL('../skills/loom/', import.meta.url));
  for (const { path } of authoringSkill('0.19.0')) {
    const source = readFileSync(join(folder, path), 'utf8');
    const before = extractLinks(source);
    const after = extractLinks(renderSkillLinks(source, path, '0.19.0'));
    expect(after.map(({ line }) => line)).toEqual(before.map(({ line }) => line));
    for (const [index, link] of before.entries()) {
      const rendered = after[index]?.target ?? '';
      const outside = link.target.startsWith('../../../');
      expect(outside ? rendered.startsWith(`${tag}/`) : rendered === link.target).toBe(true);
    }
  }
});
