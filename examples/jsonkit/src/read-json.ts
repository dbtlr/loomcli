import { createReadStream } from 'node:fs';
import { resolve } from 'node:path';
import type { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import type { Host, Out } from '@loom/core';

/** One document source: the subject each failure names, and the connection it reads. */
interface Source {
  /** A read failure names where the text came from, so a file failure keeps its path. */
  failure: string;
  /** A parse failure names the document itself. */
  name: string;
  stream: Readable;
}

function explain(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

/**
 * The source of one invocation. A supplied file is the selection; without one the piped text is.
 * The `--file` schema decides whether omission is allowed, so the reader reads no terminal fact
 * and names the source and its connection alone.
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
export async function readJson(file: string | undefined, host: Host, out: Out): Promise<unknown> {
  const source = select(file, host);
  const contents = await text(source.stream).catch((error: unknown) =>
    out.fatal(`Cannot read ${source.failure}: ${explain(error, 'The source could not be read.')}`),
  );
  try {
    const document: unknown = JSON.parse(contents);
    return document;
  } catch (error: unknown) {
    return out.fatal(
      `Cannot parse JSON in ${source.name}: ${explain(error, 'The text is not valid JSON.')}`,
    );
  }
}
