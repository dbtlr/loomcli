import type { LogEvent, LogLevel } from '@loomcli/core';

/** The levels an author can ask for, lowest first. `fatal` is core's alone and is never filtered. */
type WrittenLevel = Exclude<LogLevel, 'fatal'>;

const writtenLevels: readonly WrittenLevel[] = ['trace', 'debug', 'info', 'warn', 'error'];

/** Whether a value is one of the five levels the `level` setting accepts. */
function isWrittenLevel(value: unknown): value is WrittenLevel {
  return writtenLevels.some((level) => level === value);
}

/** Whether an event reaches the destination: at or above `floor`, and a `fatal` event always. */
function isWritten(level: LogLevel, floor: WrittenLevel): boolean {
  return level === 'fatal' || writtenLevels.indexOf(level) >= writtenLevels.indexOf(floor);
}

/**
 * The log record of one event: the event as `JSON.stringify` writes it with its keys in the
 * record order, an absent key left out, and one newline after it. The file and the console write
 * these bytes alike.
 */
function recordOf(event: LogEvent): string {
  const entries: [string, unknown][] = [
    ['time', event.time],
    ['level', event.level],
    ['message', event.message],
    ['fields', event.fields],
    ['application', event.application],
    ['run', event.run],
    ['path', event.path],
    ['plugin', event.plugin],
  ];
  if (event.failure !== undefined) {
    entries.push(['failure', event.failure]);
  }
  if (event.defect !== undefined) {
    entries.push(['defect', event.defect]);
  }
  return `${JSON.stringify(Object.fromEntries(entries))}\n`;
}

export type { WrittenLevel };
export { isWritten, isWrittenLevel, recordOf, writtenLevels };
