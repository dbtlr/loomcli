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

import { extractLinks } from '../src/helpers/markdown-links.js';

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

/** The info string of a fence opening line, as written, with how it is indented and fenced, or `undefined`. */
function fenceInfo(line: string): { fence: string; indent: string; info: string } | undefined {
  const groups = /^(?<indent>\s*)(?<fence>`{3,}|~{3,})(?<info>.*)$/u.exec(line)?.groups;
  return groups === undefined
    ? undefined
    : { fence: groups.fence ?? '', indent: groups.indent ?? '', info: groups.info ?? '' };
}

/**
 * The fences `check:types` would not compile although they hold TypeScript: one that is indented,
 * made of `~`, or whose info string begins with ts, typescript, or tsx but is not exactly `ts`, as
 * written, with nothing before it.
 */
function unreadTypeScriptFences(text: string): string[] {
  const wrong: string[] = [];
  let open = '';
  for (const [index, line] of text.split('\n').entries()) {
    const opening = fenceInfo(line);
    if (open !== '') {
      if (new RegExp(`^\\s*${open[0]}{${open.length},}\\s*$`, 'u').test(line)) {
        open = '';
      }
    } else if (opening !== undefined) {
      open = opening.fence;
      const typescript = /^\s*(?:typescript|tsx?)(?![a-z0-9])/iu.test(opening.info);
      const read =
        opening.indent === '' && opening.fence.startsWith('`') && /^ts\s*$/u.test(opening.info);
      if (typescript && !read) {
        wrong.push(`${index + 1}: ${line}`);
      }
    }
  }
  return wrong;
}

test('a fence check reads the spellings check:types would not compile', () => {
  const fences = [
    '```typescript',
    '```tsx',
    '```TS',
    '```ts title=x',
    '~~~ts',
    '  ```ts',
    '``` ts',
  ];
  for (const fence of fences) {
    expect(
      unreadTypeScriptFences(`${fence}\nconst a = 1;\n${fence.trim().slice(0, 3)}\n`),
    ).toHaveLength(1);
  }
  expect(unreadTypeScriptFences('```ts\nconst a = 1;\n```\n```json\n{}\n```\n')).toEqual([]);
});

test.each(files)('%s fences TypeScript as ts, unindented, in backticks', (file) => {
  const wrong = unreadTypeScriptFences(readFileSync(join(folder, file), 'utf8'));
  expect(wrong.map((entry) => `${file}:${entry}`)).toEqual([]);
});

/** The lines inside `ts` blocks of a Markdown text, with their 1-based line numbers. */
function tsBlockLines(text: string): { line: number; text: string }[] {
  const found: { line: number; text: string }[] = [];
  let within = false;
  for (const [index, line] of text.split('\n').entries()) {
    if (within) {
      within = !/^`{3,}\s*$/u.test(line);
      if (within) {
        found.push({ line: index + 1, text: line });
      }
    } else {
      within = /^`{3,}ts\s*$/u.test(line);
    }
  }
  return found;
}

/**
 * Prettier's default print width is 80. An author who runs it on its defaults over the managed
 * skill would otherwise reformat the file, and init would report it as drifted.
 */
test.each(files)('%s keeps every ts line within 80 characters', (file) => {
  const long = tsBlockLines(readFileSync(join(folder, file), 'utf8')).filter(
    ({ text }) => text.length > 80,
  );
  expect(long.map(({ line, text }) => `${file}:${line}: ${text.length} characters`)).toEqual([]);
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
