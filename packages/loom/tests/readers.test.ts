/*
 * The two programs `loom init` and `loom build` run under Bun to read an application module,
 * `dist/read-application.js` and `dist/read-skills.js`, bundle only their own modules. They import
 * the package's own `@loomcli/core` at run time, and the `loom` process formats the Developer
 * Diagnostic of a module that threw while it loaded, so neither carries a copy of core.
 */

import { readFileSync } from 'node:fs';

import { expect, test } from 'vite-plus/test';

/** The module comments Bun writes above each bundled module: the module's source path. */
const moduleCommentPattern = /^\/\/ (?<path>\S+\.(?:[cm]?js|ts))$/gmu;

/**
 * The source path of every module a built reader bundles, sorted. Bun writes the entry's comment
 * twice, above its imports and above its body, so each path counts once.
 */
function bundledModules(reader: string): string[] {
  const source = readFileSync(new URL(`../dist/${reader}.js`, import.meta.url), 'utf8');
  const paths = [...source.matchAll(moduleCommentPattern)].map((match) => match.groups?.path);
  return [...new Set(paths)].filter((path) => path !== undefined).toSorted();
}

test.each([
  ['read-application', ['src/read-application.ts', 'src/application-load.ts']],
  ['read-skills', ['src/read-skills.ts', 'src/application-load.ts']],
])('dist/%s.js bundles only its own modules', (reader, modules) => {
  expect(bundledModules(reader)).toEqual(modules.toSorted());
});
