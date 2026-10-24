import type { Out } from '@loomcli/core';

/** What a command's report reads from its action context. */
interface Reporting {
  readonly out: Out;
  readonly passthrough: string[];
  readonly signal: AbortSignal;
}

/**
 * Runs a command's work and renders the text it returns verbatim. A failure becomes Loom's fatal
 * exit 1 with its sentence, and an argument tail after `--` fails before the work starts. Once the
 * run is cancelled, a failure is the cancellation's: the work ends with the signal's reason, which
 * core keeps silent, so the command prints nothing and resolves the signal's code.
 */
export async function report(
  { out, passthrough, signal }: Reporting,
  work: () => Promise<string> | string,
) {
  try {
    if (passthrough.length > 0) {
      out.fatal('Arguments after -- are not supported.');
    }
    const text = await work();
    await out.render(text, { render: (value) => value });
  } catch (error) {
    signal.throwIfAborted();
    out.fatal(error instanceof Error ? error.message : String(error));
  }
}
