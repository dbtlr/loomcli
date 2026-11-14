import { DeclarationError, diagnosticRule } from '@loomcli/core';
import { strictObject, string } from 'valibot';
import type { InferOutput } from 'valibot';

/*
 * A throw while an application module loads, as the `loom` process reads it. The readers that load
 * the module under Bun hold no copy of `@loomcli/core`, so a throw that is not the package's own
 * `DeclarationError` comes back as its reason alone, and this process, which holds core, formats the
 * Developer Diagnostic.
 */

/** A module that threw while it loaded, for a throw that is not a `DeclarationError`. */
const loadFailed = diagnosticRule('@loomcli/loom/application-load-failed', {
  explanation:
    'loom imports the application module to learn what it declares, loom init how the entry imports its Application and loom build the skills folder skills() names, and the module threw while it loaded, so the command could not finish.',
  headline: 'Application failed to load',
});

/** What a reader writes when the module threw something other than a `DeclarationError`. */
const threw = strictObject({ threw: string() });

/** A reader's report of a throw: the thrown value as one reason. */
type Threw = InferOutput<typeof threw>;

/** The Developer Diagnostic of a module that threw while it loaded, for the reason a reader wrote. */
function loadFailure(module: string, reason: string): string {
  return new DeclarationError(loadFailed, {
    correction:
      'Fix the code that throws, or move the work into an action, which runs only when its Command runs.',
    sentence: `${module} threw while it loaded: ${reason}`,
  }).message;
}

export type { Threw };
export { loadFailure, threw };
