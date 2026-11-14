/*
 * Acceptance plan for the authoring skill's source (docs/decisions/0149-...).
 *
 * The skill is Markdown written by hand under `packages/loom/skills/loom/`. These tests read it as
 * the repository holds it, and they pass when:
 *
 * - A link to a file outside the skill folder is a plain relative path to a file: no leading `/`, no
 *   query, no percent-escape, and no directory target, so the repository's link check resolves it
 *   and init can render it at a tag.
 * - A TypeScript fence is `ts`, never `typescript` or `tsx`, so `check:types` compiles each block.
 * - `SKILL.md`'s frontmatter parses as YAML with `name: loom`, a `description`, and a string
 *   `metadata.version`.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';
import { parse } from 'yaml';
import { z } from 'zod';

import { extractLinks } from '../../../scripts/check-links.mjs';

/** The skill folder as the repository holds it. */
const folder = fileURLToPath(new URL('../skills/loom/', import.meta.url));

/** The files of the skill, as paths below its folder. */
function skillFiles(directory = ''): string[] {
  return readdirSync(join(folder, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? skillFiles(`${directory}${entry.name}/`) : [`${directory}${entry.name}`],
  );
}

const files = skillFiles();

/** Whether a path lies inside the skill folder. */
function inside(path: string): boolean {
  return path === folder.slice(0, -1) || path.startsWith(folder);
}

test('the skill folder holds SKILL.md and Markdown references', () => {
  expect(files).toContain('SKILL.md');
  expect(files.filter((file) => file !== 'SKILL.md').length).toBeGreaterThan(0);
  expect(files.filter((file) => !file.endsWith('.md'))).toEqual([]);
});

/** What is wrong with a link target that leaves the skill folder, or `undefined` when it is fine. */
function outsideProblem(file: string, target: string): string | undefined {
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/iu.test(target) || target.startsWith('#')) {
    return undefined;
  }
  const path = target.split('#')[0] ?? '';
  const resolved = resolve(dirname(join(folder, file)), path);
  if (inside(resolved)) {
    return undefined;
  }
  if (path.startsWith('/')) {
    return 'a leading /';
  }
  if (path.includes('?')) {
    return 'a query';
  }
  if (path.includes('%')) {
    return 'a percent-escape';
  }
  return existsSync(resolved) && statSync(resolved).isFile() ? undefined : 'not a file';
}

test.each(files)('%s links to files outside the skill folder by a plain relative path', (file) => {
  const links = extractLinks(readFileSync(join(folder, file), 'utf8'));
  const problems = links.flatMap(({ line, target }) => {
    const problem = outsideProblem(file, target);
    return problem === undefined ? [] : [`${file}:${line}: ${target}: ${problem}`];
  });
  expect(problems).toEqual([]);
});

test.each(files)('%s fences TypeScript as ts', (file) => {
  const lines = readFileSync(join(folder, file), 'utf8').split('\n');
  const wrong = lines.flatMap((line, index) =>
    /^\s*(?:`{3,}|~{3,})\s*(?:typescript|tsx)\b/iu.test(line)
      ? [`${file}:${index + 1}: ${line}`]
      : [],
  );
  expect(wrong).toEqual([]);
});

test('SKILL.md carries the name loom, a description, and a string metadata.version', () => {
  const text = readFileSync(join(folder, 'SKILL.md'), 'utf8');
  const source = /^---\n(?<yaml>[\s\S]*?)\n---\n/u.exec(text)?.groups?.yaml;
  expect(source).toBeDefined();
  const frontmatter = z
    .object({
      description: z.string().min(1),
      metadata: z.object({ version: z.string().regex(/^\d+\.\d+\.\d+$/u) }),
      name: z.literal('loom'),
    })
    .safeParse(parse(source ?? ''));
  expect(frontmatter.error).toBeUndefined();
});
