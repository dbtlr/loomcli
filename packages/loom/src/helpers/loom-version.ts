import { readFileSync } from 'node:fs';

import { z } from 'zod';

import { toolRanges } from './tooling.js';

/**
 * The manifest of `@loomcli/loom`, read at run time because it sits outside the compiled `src`
 * root. `../../package.json` names it from `src/helpers` and from `dist/helpers` alike.
 */
const source = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');

/**
 * The manifest fields the toolchain reads: its version, and the range it declares as an optional
 * peer dependency for each tool package a scaffold pins.
 */
const manifest = z
  .object({
    peerDependencies: toolRanges,
    version: z.string(),
  })
  .parse(JSON.parse(source));

/** The running toolchain's version, which `--version` prints and `loom init` pins. */
export const loomVersion = manifest.version;

/**
 * The range `@loomcli/loom` declares as an optional peer dependency for each tool package a
 * scaffold pins: the TypeScript compiler, the linters, and the test runners.
 */
export const scaffoldRanges = manifest.peerDependencies;
