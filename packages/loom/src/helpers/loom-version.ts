import { readFileSync } from 'node:fs';

import { object, string } from 'valibot';

import { parseOrThrow } from './parse-or-throw.js';

/**
 * The manifest of `@loomcli/loom`, read at run time because it sits outside the compiled `src`
 * root. `../../package.json` names it from `src/helpers` and from `dist/helpers` alike.
 */
const source = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');

/** The manifest fields the toolchain reads: its version and the TypeScript range it declares. */
const manifestSchema = object({
  peerDependencies: object({ typescript: string() }),
  version: string(),
});

const manifest = parseOrThrow(manifestSchema, JSON.parse(source));

/** The running toolchain's version, which `--version` prints and `loom init` pins. */
export const loomVersion = manifest.version;

/**
 * The TypeScript range `@loomcli/loom` declares as its optional peer, which `loom init` pins as a
 * new scaffold's compiler so `loom check` runs its type pass.
 */
export const typescriptRange = manifest.peerDependencies.typescript;
