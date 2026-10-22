import { createValidator } from '@loomcli/validators';
import type { ParseResult } from '@loomcli/validators';
import { object, optional, safeParse, string } from 'valibot';

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

/** The sentence every refused target ends with, naming the targets a build accepts. */
const acceptedTargets =
  'Use node, bun, or a Bun compile target bun-<os>-<arch> for linux or darwin on x64 or arm64, with -musl on linux and -baseline or -modern on x64, such as bun-linux-x64.';

/** Reads one `--target` value, or answers the sentence that refuses it. */
function readTarget(value: string): BuildTarget | { readonly refused: string } {
  if (value === 'node' || value === 'bun') {
    return { kind: 'bundle', name: value };
  }
  const platform = compileTarget.exec(value)?.groups?.platform;
  if (platform !== undefined) {
    return { kind: 'compile', name: value, platform };
  }
  if (value === 'browser') {
    return {
      refused: `browser is refused, because a Loom application runs as a command. ${acceptedTargets}`,
    };
  }
  return { refused: `${JSON.stringify(value)} is not a target. ${acceptedTargets}` };
}

/** The glibc version a Node-compatible runtime reports, which a musl host leaves out. */
const header = object({ glibcVersionRuntime: optional(string()) });

const report = object({ header });

/**
 * The one target a build writes: a JavaScript bundle for a runtime, or a single binary that Bun
 * compiles for a platform. `platform` is the compile target without its `bun-` prefix, such as
 * `linux-x64-musl`, which an asset name carries.
 */
export type BuildTarget =
  | { readonly kind: 'bundle'; readonly name: 'bun' | 'node' }
  | { readonly kind: 'compile'; readonly name: string; readonly platform: string };

/** The `--target` validator, whose output is the target it read. */
export const targetOption = createValidator({
  inputSchema: { type: 'string' },
  parse: (raw): ParseResult<BuildTarget> => {
    const target = readTarget(raw);
    return 'refused' in target ? { issues: [{ message: target.refused }] } : { value: target };
  },
});

/**
 * The compile target Bun names for the host: the run's platform, the process's architecture, and
 * musl on Alpine.
 */
export function hostTarget(platform: string): BuildTarget {
  const os = platform;
  const reported = safeParse(report, process.report.getReport());
  const glibc = reported.success ? reported.output.header.glibcVersionRuntime : undefined;
  const variant = os === 'linux' && glibc === undefined ? '-musl' : '';
  const name = `bun-${os}-${process.arch}${variant}`;
  const target = readTarget(name);
  if ('refused' in target) {
    throw new Error(`Bun compiles for no target on this host (${name}), so pass --target.`);
  }
  return target;
}

export { acceptedTargets };
