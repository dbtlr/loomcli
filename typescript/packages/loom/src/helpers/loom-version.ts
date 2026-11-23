/*
 * The manifest of `@loomcli/loom`, imported so the bundle carries it: the published bin reads no
 * file to learn its own version.
 */
import manifest from '../../package.json' with { type: 'json' };

/** The running toolchain's version, which `--version` prints and `loom init` pins. */
export const loomVersion = manifest.version;

/**
 * The TypeScript range `@loomcli/loom` declares as its optional peer, which `loom init` pins as a
 * new scaffold's compiler, which its `check` script runs as `tsc --noEmit`.
 */
export const typescriptRange = manifest.peerDependencies.typescript;
