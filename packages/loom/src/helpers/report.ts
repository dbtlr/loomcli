import type { Out } from '@loomcli/core';

/**
 * Runs a command's work and renders the text it returns verbatim. A failure becomes Loom's fatal
 * exit 1 with its sentence, and an argument tail after `--` fails before the work starts.
 */
export async function report(
  out: Out,
  passthrough: string[],
  work: () => Promise<string> | string,
) {
  try {
    if (passthrough.length > 0) {
      out.fatal('Arguments after -- are not supported.');
    }
    const text = await work();
    await out.render(text, { render: (value) => value });
  } catch (error) {
    out.fatal(error instanceof Error ? error.message : String(error));
  }
}
