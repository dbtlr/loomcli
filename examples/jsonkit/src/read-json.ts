import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import { FatalError } from '@loomcli/core';
import type { ContextualStyle, Host, Out } from '@loomcli/core';

import { checkFileOrStdin } from './file-or-stdin.js';

/** One document source: the subject a read failure names, and the connection it reads. */
interface Source {
  /** A read failure names where the text came from, so a file failure keeps its path. */
  failure: string;
  stream: Readable;
}

/**
 * The reason a runtime gave, or the fallback, as one sentence ending in a period. A reason that
 * already ends with one keeps it, so the fix that follows never reads after two periods.
 */
function explain(error: unknown, fallback: string): string {
  const reason = error instanceof Error ? error.message : fallback;
  return reason.endsWith('.') ? reason : `${reason}.`;
}

/**
 * The source of one invocation. A supplied file is the selection; without one the piped text is.
 * `readJson` has already decided whether omission is allowed, so this names the source and its
 * connection alone.
 */
function select(file: string | undefined, host: Host): Source {
  if (file === undefined) {
    return { failure: 'stdin', stream: host.stdin };
  }
  return {
    failure: `file: ${file}`,
    stream: createReadStream(resolve(host.cwd, file)),
  };
}

/** The count of `--verbose` from which the reader names its source before reading it. */
const namingCount = 1;

/**
 * What an action hands the reader: the two global options that choose and name the source, the
 * host, the channel the source's name is written through, and the style that escapes it.
 */
export interface DocumentReading {
  readonly host: Host;
  readonly options: { readonly file: string | undefined; readonly verbose: number };
  readonly out: Pick<Out, 'info'>;
  readonly style: Pick<ContextualStyle, 'escape'>;
}

/**
 * Every action reads its document here, so a read failure reads the same everywhere. With
 * `--verbose` it first names the source on one info line, whatever the count. A malformed document
 * throws the `SyntaxError` `JSON.parse` raises, which the application's translator turns into its
 * `InvalidJsonError`.
 */
export async function readJson({ host, options, out, style }: DocumentReading): Promise<unknown> {
  const { file, verbose } = options;
  checkFileOrStdin(file, host);
  if (verbose >= namingCount) {
    await out.info(file === undefined ? 'Reading stdin.' : `Reading ${style.escape(file)}.`);
  }
  const source = select(file, host);
  const contents = await text(source.stream).catch((error: unknown) => {
    throw new FatalError(
      `Cannot read ${source.failure}: ${explain(error, 'The source could not be read.')} Supply a readable file, or pipe JSON to stdin.`,
    );
  });
  const document: unknown = JSON.parse(contents);
  return document;
}
