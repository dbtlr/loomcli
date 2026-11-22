import { escapeControlCharacters, FatalError, style } from '@loomcli/core';
import type { Content, Log } from '@loomcli/core';

/**
 * The reason a runtime gave, or the fallback, as one sentence ending in a period. A reason that
 * already ends with one keeps it, so the fix that follows never reads after two periods. A runtime
 * reason can quote the path it failed on, so its control characters and markup are escaped as the
 * name's are.
 */
function explain(error: unknown, fallback: string): string {
  const reason =
    error instanceof Error ? style.escape(escapeControlCharacters(error.message)) : fallback;
  return reason.endsWith('.') ? reason : `${reason}.`;
}

/** The prepared document handle and the log that names the source. */
export interface DocumentReading {
  readonly options: { readonly file: Content };
  readonly log: Log;
}

/**
 * Every action reads its document here, so a read failure reads the same everywhere. It first
 * names the source in one debug log event, which the operator's `-v` shows, with the file name in
 * the event's fields, so core escapes it on screen and the message stays one searchable template.
 * A malformed document throws the `SyntaxError` `JSON.parse` raises, which the application's
 * translator turns into its `InvalidJsonError`.
 */
export async function readJson({ log, options }: DocumentReading): Promise<unknown> {
  const { file } = options;
  if (file.kind === 'stdin') {
    log.debug('Reading stdin.');
  } else {
    log.debug('Reading {file}.', { file: file.name });
  }
  const subject =
    file.kind === 'stdin' ? 'stdin' : `file: ${style.escape(escapeControlCharacters(file.name))}`;
  const contents = await file.text().catch((error: unknown) => {
    throw new FatalError(
      `Cannot read ${subject}: ${explain(error, 'The source could not be read.')} Supply a readable file, or pipe JSON to stdin.`,
    );
  });
  const document: unknown = JSON.parse(contents);
  return document;
}
