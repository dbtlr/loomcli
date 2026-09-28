import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import { FatalError } from '@loomcli/core';
import type { Host } from '@loomcli/core';

import { checkFileOrStdin } from './file-or-stdin.js';

/** One document source: the subject each failure names, and the connection it reads. */
interface Source {
  /** A read failure names where the text came from, so a file failure keeps its path. */
  failure: string;
  /** A parse failure names the document itself. */
  name: string;
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
    return { failure: 'stdin', name: 'stdin', stream: host.stdin };
  }
  return {
    failure: `file: ${file}`,
    name: file,
    stream: createReadStream(resolve(host.cwd, file)),
  };
}

/** Every action reads its document here, so read and parse failures read the same everywhere. */
export async function readJson(file: string | undefined, host: Host): Promise<unknown> {
  checkFileOrStdin(file, host);
  const source = select(file, host);
  const contents = await text(source.stream).catch((error: unknown) => {
    throw new FatalError(
      `Cannot read ${source.failure}: ${explain(error, 'The source could not be read.')} Supply a readable file, or pipe JSON to stdin.`,
    );
  });
  try {
    const document: unknown = JSON.parse(contents);
    return document;
  } catch (error: unknown) {
    throw new FatalError(
      `Cannot parse JSON in ${source.name}: ${explain(error, 'The text is not valid JSON.')} Correct its syntax, or supply another document.`,
    );
  }
}
