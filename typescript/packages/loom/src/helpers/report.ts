import { UsageError } from '@loomcli/core';
import type { Out } from '@loomcli/core';

import { cannotUseFile, systemFailure, systemVerb } from './messages.js';
import { systemErrorFacts } from './system-error.js';

/** What a command's report reads from its action context. */
interface Reporting {
  readonly out: Out;
  readonly signal: AbortSignal;
}

/**
 * The sentence of a failure a command's work threw. A system error no code on the way caught is
 * worded from its facts: the path, what the call was doing to it, and the cause, or the general
 * sentence with its code when it carries no path. Any other throw prints its own message, which is
 * the bin's sentence for every failure the bin raises, and a runtime's text only for a defect of the
 * bin's own inputs, which ADR-0164 lists.
 */
function failureSentence(error: unknown): string {
  const facts = systemErrorFacts(error);
  if (facts === undefined) {
    return error instanceof Error ? error.message : String(error);
  }
  return facts.path === undefined
    ? systemFailure(facts.code)
    : cannotUseFile(systemVerb(facts.syscall), facts.path, facts.code);
}

/**
 * Runs a command's work and renders the text it returns verbatim. A failure becomes Loom's fatal
 * exit 1 with its sentence, except a usage error, which the work finds only once it has read the
 * package, and which core prints with its exit code 2 and the usage hint. Once the run is cancelled, a failure is the cancellation's: the work
 * ends with the signal's reason, which core keeps silent, so the command prints nothing and
 * resolves the signal's code.
 */
export async function report({ out, signal }: Reporting, work: () => Promise<string> | string) {
  try {
    const text = await work();
    // Work that finished after a cancel, such as a request that obeys only its own timeout, prints nothing.
    signal.throwIfAborted();
    await out.render(text, { render: (value) => value });
  } catch (error) {
    signal.throwIfAborted();
    if (error instanceof UsageError) {
      throw error;
    }
    out.fatal(failureSentence(error));
  }
}
