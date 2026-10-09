import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

import { z } from 'zod';

import { runBun } from './bun.js';

/** The `bin` map of a `typescript` package, whose `tsc` entry runs the compiler. */
const tscBin = z.object({ tsc: z.string() });

/** The `bin` of the `typescript` package, a path or a map whose `tsc` entry runs the compiler. */
const typescriptManifest = z.object({ bin: z.string().or(tscBin) });

/**
 * The compiler the package resolves: the `tsc` bin of the `typescript` package that resolves from
 * the package directory, so one hoisted to a monorepo root counts. `undefined` when none resolves.
 */
function resolveCompiler(directory: string): string | undefined {
  let manifestPath = '';
  try {
    manifestPath = createRequire(join(directory, 'package.json')).resolve(
      'typescript/package.json',
    );
  } catch {
    return undefined;
  }
  const parsed = typescriptManifest.safeParse(JSON.parse(readFileSync(manifestPath, 'utf8')));
  if (!parsed.success) {
    return undefined;
  }
  const { bin } = parsed.data;
  return join(dirname(manifestPath), typeof bin === 'string' ? bin : bin.tsc);
}

/** The type pass's outcome: skipped with a one-line note, or run with the compiler's report. */
export type TypePass =
  | { readonly kind: 'skipped'; readonly note: string }
  | { readonly kind: 'ran'; readonly failed: boolean; readonly report: string };

/**
 * Runs the package's own TypeScript against its `tsconfig.json`, emitting nothing, under Bun. Any
 * error the compiler reports fails the pass. With no `tsconfig.json` or no compiler, the pass is
 * skipped with a note.
 */
export function typePass(directory: string): TypePass {
  const tsconfig = join(directory, 'tsconfig.json');
  if (!existsSync(tsconfig)) {
    return {
      kind: 'skipped',
      note: 'note: The package has no tsconfig.json, so the type pass was skipped.',
    };
  }
  const compiler = resolveCompiler(directory);
  if (compiler === undefined) {
    return {
      kind: 'skipped',
      note: 'note: No TypeScript compiler resolves from the package, so the type pass was skipped.',
    };
  }
  const result = runBun([compiler, '--noEmit', '--pretty', 'false', '-p', tsconfig], directory);
  return { failed: result.status !== 0, kind: 'ran', report: result.output.trim() };
}
