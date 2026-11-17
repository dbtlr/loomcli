/*
 * A subpath of the plugin pack imports nothing from a sibling subpath except the sibling's
 * declarations module, `extension`. It never imports a sibling's entry, middleware, views, or
 * messages module. The modules at the top of `src` are shared, so any plugin may import them.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vite-plus/test';

const src = fileURLToPath(new URL('../src', import.meta.url));

/** The one module of a plugin folder that a sibling may import. */
const declarationsModule = 'extension.ts';

/**
 * The plugin folders, which are the directories directly under `src` whose entry module,
 * `plugin.ts`, a subpath export names. The `installation` and `markdown` folders are shared
 * libraries with no entry, so any plugin may import them.
 */
function pluginFolders(): string[] {
  return readdirSync(src, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(src, entry.name, 'plugin.ts')))
    .map((entry) => entry.name);
}

/** Every source module under a plugin folder, as a path relative to `src`. */
function modulesOf(folder: string): string[] {
  return readdirSync(join(src, folder), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.tsx?$/u.test(entry.name))
    .map((entry) => relative(src, join(entry.parentPath, entry.name)));
}

/**
 * The relative specifiers of the static imports, re-exports, and dynamic imports in a source text.
 * A block comment may sit before the specifier, as a bundler's hint comment does inside `import()`.
 */
function relativeSpecifiers(text: string): string[] {
  const pattern =
    /(?:\bfrom\s*|\bimport\s*\(?\s*)(?:\/\*[\s\S]*?\*\/\s*)*(?<quote>['"])(?<specifier>\.{1,2}\/[^'"]*)\k<quote>/gu;
  return [...text.matchAll(pattern)].map((match) => match.groups?.specifier ?? '');
}

/** The source file a relative specifier names, as a path relative to `src`. */
function sourceOf(importer: string, specifier: string): string {
  const target = resolve(dirname(join(src, importer)), specifier);
  return relative(src, target).replace(/\.js$/u, '.ts');
}

/** The plugin folder a path under `src` belongs to, or undefined at the top of `src`. */
function folderOf(path: string): string | undefined {
  const [first, ...rest] = path.split(sep);
  return rest.length > 0 ? first : undefined;
}

/** Each import that reaches a sibling plugin folder other than through its declarations module. */
function siblingImports(): string[] {
  const found: string[] = [];
  const plugins = pluginFolders();
  for (const folder of plugins) {
    for (const importer of modulesOf(folder)) {
      for (const specifier of relativeSpecifiers(readFileSync(join(src, importer), 'utf8'))) {
        const imported = sourceOf(importer, specifier);
        const target = folderOf(imported);
        const reachesSibling =
          target !== undefined && target !== folder && plugins.includes(target);
        if (reachesSibling && imported !== join(target, declarationsModule)) {
          found.push(`${importer} imports ${imported}`);
        }
      }
    }
  }
  return found;
}

test('the scan reads plugin modules and their relative imports', () => {
  expect(pluginFolders()).toContain('version');
  expect(modulesOf('version').length).toBeGreaterThan(0);
  expect(
    relativeSpecifiers(
      "import type { A } from './a.js';\nexport { b } from '../b.js';\nawait import('./c.js');\nawait import(/* hint */ '../d.js');\nimport 'node:fs';\nimport x from 'pkg';",
    ),
  ).toEqual(['./a.js', '../b.js', './c.js', '../d.js']);
});

test('a plugin imports a sibling plugin only through its declarations module', () => {
  expect(siblingImports()).toEqual([]);
});
