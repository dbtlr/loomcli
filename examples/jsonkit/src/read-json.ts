import { escapeControlCharacters, FatalError } from '@loomcli/core';
import type { Content, ContextualStyle, Out } from '@loomcli/core';

/**
 * The reason a runtime gave, or the fallback, as one sentence ending in a period. A reason that
 * already ends with one keeps it, so the fix that follows never reads after two periods. A runtime
 * reason can quote the path it failed on, so its control characters are escaped as the name's are.
 */
function explain(error: unknown, fallback: string): string {
  const reason = error instanceof Error ? escapeControlCharacters(error.message) : fallback;
  return reason.endsWith('.') ? reason : `${reason}.`;
}

/** The count of `--verbose` from which the reader names its source before reading it. */
const namingCount = 1;

/**
 * The prepared document handle, the verbosity count, and the output that names the source.
 */
export interface DocumentReading {
  readonly options: { readonly file: Content; readonly verbose: number };
  readonly out: Pick<Out, 'info'>;
  readonly style: Pick<ContextualStyle, 'escape'>;
}

/**
 * Every action reads its document here, so a read failure reads the same everywhere. With
 * `--verbose` it first names the source on one info line, whatever the count, with its control
 * characters escaped as every other operator-supplied name jsonkit prints. A malformed document
 * throws the `SyntaxError` `JSON.parse` raises, which the application's translator turns into its
 * `InvalidJsonError`.
 */
export async function readJson({ options, out, style }: DocumentReading): Promise<unknown> {
  const { file, verbose } = options;
  if (verbose >= namingCount) {
    await out.info(
      file.kind === 'stdin'
        ? 'Reading stdin.'
        : `Reading ${style.escape(escapeControlCharacters(file.name))}.`,
    );
  }
  const subject = file.kind === 'stdin' ? 'stdin' : `file: ${escapeControlCharacters(file.name)}`;
  const contents = await file.text().catch((error: unknown) => {
    throw new FatalError(
      `Cannot read ${subject}: ${explain(error, 'The source could not be read.')} Supply a readable file, or pipe JSON to stdin.`,
    );
  });
  const document: unknown = JSON.parse(contents);
  return document;
}
