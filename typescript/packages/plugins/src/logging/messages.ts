import { escapeControlCharacters } from '@loomcli/core';

/*
 * The operator sentences of the logging plugin, under ADR-0164, ADR-0165, and ADR-0174: the
 * messages of the log lines `-v` and `-vv` show. `tests/message-voice.test.ts` holds this module to
 * the failure message voice.
 */

/** The `debug` log line that names the file the plugin appends records to. */
const loggingTo = 'Logging to {path}.';

/** The `trace` log line for a rotation that renamed or deleted the file. */
const rotated = 'Rotated {path}.';

/** An unusable operator level keeps the declared levels. */
function badLevel(name: string, value: string): string {
  return `Cannot use ${escapeControlCharacters(name)}=${escapeControlCharacters(value)} as a log level. Use trace, debug, info, warn, or error; using the application's log levels for this run.`;
}

/** An unusable operator path keeps the declared files. */
function badFile(name: string, value: string): string {
  return `Cannot append to the log file ${escapeControlCharacters(value)} named by ${escapeControlCharacters(name)}. Set it to a writable file path; using the application's log file for this run.`;
}

/** The file holding records already appended by this run. */
function failureLog(path: string, run: string): string {
  return `Read the log of this run in ${escapeControlCharacters(path)} (run ${escapeControlCharacters(run)}).`;
}

export { badFile, badLevel, failureLog, loggingTo, rotated };
