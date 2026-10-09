import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { z } from 'zod';

import { runBun } from './bun.js';

/**
 * What the graph checks found: the message of every fault, each a whole Developer Diagnostic, or
 * the one sentence that says why no Application could be checked.
 */
const checkResult = z.union([
  z.object({ faults: z.string().array() }),
  z.object({ failure: z.string() }),
]);

/** The script the checking process runs, shipped beside this module in `dist`. */
const script = fileURLToPath(new URL('../check-application.js', import.meta.url));

/** One run of the graph checks, as the checking process writes it to its result file. */
export type CheckResult = z.infer<typeof checkResult>;

/** The graph checks' answer and whatever the application module wrote while it loaded. */
export interface ApplicationCheck {
  readonly result: CheckResult;
  readonly written: string;
}

/**
 * Runs the graph checks of one application module under Bun, in a process of its own, and reads
 * its result from a file the process writes, so nothing the module prints while it loads can be
 * mistaken for the result. A process that ends without a result fails with what it wrote.
 */
export function checkApplication(options: {
  cwd: string;
  directory: string;
  module: string;
  path: string;
}): ApplicationCheck {
  const temporary = mkdtempSync(join(tmpdir(), 'loom-check-'));
  try {
    const resultFile = join(temporary, 'result.json');
    const run = runBun(
      [script, resultFile, options.directory, options.path, options.module],
      options.cwd,
    );
    const written = run.output.trim();
    if (run.status !== 0 || !existsSync(resultFile)) {
      throw new Error(`${written}\n\nBun could not check ${options.module}.`.trim());
    }
    return { result: checkResult.parse(JSON.parse(readFileSync(resultFile, 'utf8'))), written };
  } finally {
    rmSync(temporary, { force: true, recursive: true });
  }
}
