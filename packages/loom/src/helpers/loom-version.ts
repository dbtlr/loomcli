import { readFileSync } from 'node:fs';

import { z } from 'zod';

/**
 * The version of `@loomcli/loom`, read from its manifest at run time because the manifest sits
 * outside the compiled `src` root. `../../package.json` names it from `src/helpers` and from
 * `dist/helpers` alike.
 */
const manifest = readFileSync(new URL('../../package.json', import.meta.url), 'utf8');

/** The running toolchain's version, which `--version` prints and `loom init` pins. */
export const loomVersion = z.object({ version: z.string() }).parse(JSON.parse(manifest)).version;
