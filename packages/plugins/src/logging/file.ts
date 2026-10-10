import { appendFileSync, mkdirSync, renameSync, statSync, unlinkSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';

import { LoggingError } from './error.js';

/** Where a failure goes: the author's `onError`, or nowhere. */
type Report = (error: LoggingError) => void;

/** The log file, what it keeps, and where a failed step goes. */
interface FileSink {
  readonly path: string;
  /** The size past which the file rotates. */
  readonly maxBytes: number;
  /** How many rotated copies stay. */
  readonly keep: number;
  readonly report: Report;
}

const EMPTY = 0;
const FIRST = 1;

/** Whether a runtime error says the path, or a directory on it, does not exist. */
function isMissing(error: unknown): boolean {
  return error instanceof Error && Reflect.get(error, 'code') === 'ENOENT';
}

/**
 * The name of the `number`th rotated copy: the number goes before the file's last extension,
 * `collector.1.jsonl`, or after a name that has none, `hub.1`.
 */
function copyName(path: string, number: number): string {
  const { dir, ext, name } = parse(path);
  return join(dir, `${name}.${number}${ext}`);
}

/** The size of the file now, or 0 when it is not there. */
function sizeOf(path: string): number {
  try {
    return statSync(path).size;
  } catch {
    return EMPTY;
  }
}

/** Runs a file operation that a missing source does not fail: the file it names is already gone. */
function unlessMissing(operation: () => void): void {
  try {
    operation();
  } catch (error) {
    if (!isMissing(error)) {
      throw error;
    }
  }
}

/**
 * Deletes the copy past `keep`, shifts each older copy up one, and renames the file to the first
 * copy. A copy that is not there is skipped, and so is a file that is not there: another process
 * rotated it first, and the record then goes to the file now at the path.
 */
function rotate(path: string, keep: number): void {
  unlessMissing(() => unlinkSync(copyName(path, keep)));
  for (let number = keep - FIRST; number >= FIRST; number -= FIRST) {
    unlessMissing(() => renameSync(copyName(path, number), copyName(path, number + FIRST)));
  }
  unlessMissing(() => renameSync(path, copyName(path, FIRST)));
}

/** Rotates the file when the record would take it past `maxBytes`, reporting a failure. */
function rotateWhenFull({ keep, maxBytes, path, report }: FileSink, bytes: number): void {
  const size = sizeOf(path);
  // A file with nothing in it has nothing to rotate, so an oversize record lands whole in it.
  if (size === EMPTY || size + bytes <= maxBytes) {
    return;
  }
  try {
    rotate(path, keep);
  } catch (error) {
    report(new LoggingError('rotate', { cause: error, path }));
  }
}

/** What one append threw, or `undefined` when it wrote the record. */
function appendFailure(path: string, record: string): unknown {
  try {
    appendFileSync(path, record);
    return undefined;
  } catch (error) {
    return error;
  }
}

/** The failure to create a directory and its parents, or `undefined` when it exists after the call. */
function createDirectory(directory: string): LoggingError | undefined {
  try {
    mkdirSync(directory, { recursive: true });
    return undefined;
  } catch (error) {
    return new LoggingError('create-directory', { cause: error, path: directory });
  }
}

/**
 * Appends the record with one synchronous write, creating a missing directory once. It answers the
 * failure of the step that failed, or `undefined` when the record was written.
 */
function append(path: string, record: string): LoggingError | undefined {
  const failure = appendFailure(path, record);
  if (failure === undefined) {
    return undefined;
  }
  if (!isMissing(failure)) {
    return new LoggingError('append', { cause: failure, path });
  }
  const created = createDirectory(dirname(path));
  if (created !== undefined) {
    return created;
  }
  const retried = appendFailure(path, record);
  return retried === undefined ? undefined : new LoggingError('append', { cause: retried, path });
}

/**
 * Writes one record to the file before returning: it rotates first when the record would pass
 * `maxBytes`, then appends. A failed step goes to the sink's `report`, and the next record tries
 * again. A failed rotation still appends, so a record is lost only when the append itself fails.
 */
function writeRecord(sink: FileSink, record: string): void {
  rotateWhenFull(sink, Buffer.byteLength(record));
  const failure = append(sink.path, record);
  if (failure !== undefined) {
    sink.report(failure);
  }
}

export type { FileSink, Report };
export { writeRecord };
