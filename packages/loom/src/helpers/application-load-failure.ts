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
    'loom imports the application module to learn what it declares, loom init how the entry imports its Application, loom build the skills folder skills() names, loom skills export its skill files, and loom docs the Commands it documents. The module threw while it loaded, so the command could not finish.',
  headline: 'Application failed to load',
});

const loaderFailed = diagnosticRule('@loomcli/loom/skill-loader-failed', {
  explanation:
    'loom skills export loaded the application, but the author code that supplies the files of a skill threw, so nothing was written.',
  headline: 'Skill files loader failed',
});

/** What a reader writes when the module threw something other than a `DeclarationError`. */
const threw = strictObject({ threw: string() });

/** A reader's report of a throw: the thrown value as one reason. */
type Threw = InferOutput<typeof threw>;

/** The Developer Diagnostic of a module that threw while it loaded, for the reason a reader wrote. */
function loadFailure(module: string, reason: string, loader = false): string {
  return new DeclarationError(loader ? loaderFailed : loadFailed, {
    correction: loader
      ? 'Fix the skill files loader and run loom skills export again.'
      : 'Fix the code that throws, or move the work into an action, which runs only when its Command runs.',
    sentence: loader
      ? `A skill's files loader in ${module} threw: ${reason}`
      : `${module} threw while it loaded: ${reason}`,
  }).message;
}

export type { Threw };
export { loadFailure, threw };
