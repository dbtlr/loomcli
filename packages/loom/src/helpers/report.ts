import type { Out } from '@loomcli/core';

import { systemFailure } from './messages.js';
import { systemErrorCode } from './system-error.js';

/** What a command's report reads from its action context. */
interface Reporting {
  readonly out: Out;
  readonly signal: AbortSignal;
}

/**
 * The sentence of a failure a command's work threw: the bin's own, or, for a system error no code
 * on the way caught, the general sentence with its code, so no runtime text reaches the operator.
 */
function failureSentence(error: unknown): string {
  const code = systemErrorCode(error);
  if (code !== undefined) {
    return systemFailure(code);
  }
  return error instanceof Error ? error.message : String(error);
}

/**
 * Runs a command's work and renders the text it returns verbatim. A failure becomes Loom's fatal
 * exit 1 with its sentence. Once the run is cancelled, a failure is the cancellation's: the work
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
    out.fatal(failureSentence(error));
  }
}
