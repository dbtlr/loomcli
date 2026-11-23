import type { Host } from '@loomcli/core';
import { createValidator } from '@loomcli/validators';
import type { ParseResult } from '@loomcli/validators';

import { noHostTarget, refusedTarget } from './messages.js';

/**
 * A Bun compile target, as Bun 1.4.2 documents them, for the platforms CI runs: `bun-<os>-<arch>`
 * for `linux` or `darwin` on `x64` or `arm64`, then `-musl` on Linux alone, then `-baseline` or
 * `-modern` on x64 alone, such as `bun-linux-x64-musl-baseline`. Bun itself also tolerates the
 * variants in any order, repeated, or both CPU variants at once, and a CPU variant on arm64, which
 * it ignores; each of those names a target above, so a build refuses it rather than give one binary
 * two names.
 */
const compileTarget =
  /^bun-(?<platform>linux-(?:x64(?:-musl)?(?:-baseline|-modern)?|arm64(?:-musl)?)|darwin-(?:x64(?:-baseline|-modern)?|arm64))$/u;

/** Reads one `--target` value, or answers the sentence that refuses it. */
function readTarget(value: string): TargetChoice | { readonly refused: string } {
  if (value === 'node' || value === 'bun') {
    return { kind: 'bundle', name: value };
  }
  if (value === 'npm') {
    return { kind: 'npm', name: value };
  }
  const platform = compileTarget.exec(value)?.groups?.platform;
  if (platform !== undefined) {
    return { kind: 'compile', name: value, platform };
  }
  return { refused: refusedTarget(value) };
}

/**
 * The one target a build writes: a JavaScript bundle for a runtime, or a single binary that Bun
 * compiles for a platform. `platform` is the compile target without its `bun-` prefix, such as
 * `linux-x64-musl`, which an asset name carries.
 */
export type BuildTarget =
  | { readonly kind: 'bundle'; readonly name: 'bun' | 'node' }
  | { readonly kind: 'compile'; readonly name: string; readonly platform: string };

/**
 * What `--target` names: one target, or `npm`, the launcher and platform packages, which a build
 * writes from one compile target per platform, under ADR-0213.
 */
export type TargetChoice = BuildTarget | { readonly kind: 'npm'; readonly name: 'npm' };

/** The compile target that builds one platform package's binary, such as `bun-linux-x64-musl`. */
export function platformTarget(platform: string): BuildTarget {
  return { kind: 'compile', name: `bun-${platform}`, platform };
}

/** The `--target` validator, whose output is the target it read. */
export const targetOption = createValidator({
  inputSchema: { type: 'string' },
  parse: (raw): ParseResult<TargetChoice> => {
    const target = readTarget(raw);
    return 'refused' in target ? { issues: [{ message: target.refused }] } : { value: target };
  },
});

/**
 * The compile target Bun names for the host: the run's platform and architecture, and musl on a
 * Linux host whose C library is musl, such as Alpine.
 */
export function hostTarget(host: Pick<Host, 'arch' | 'libc' | 'platform'>): BuildTarget {
  const variant = host.libc === 'musl' ? '-musl' : '';
  const name = `bun-${host.platform}-${host.arch}${variant}`;
  const target = readTarget(name);
  if ('refused' in target || target.kind === 'npm') {
    throw new Error(noHostTarget(name));
  }
  return target;
}

export { acceptedTargets } from './messages.js';
