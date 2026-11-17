/*
 * The operator sentences of the logging plugin, under ADR-0164, ADR-0165, and ADR-0174: the
 * messages of the log lines `-v` and `-vv` show. `tests/message-voice.test.ts` holds this module to
 * the failure message voice.
 */

/** The `debug` log line that names the file the plugin appends records to. */
const loggingTo = 'Logging to {path}.';

/** The `trace` log line for a rotation that renamed or deleted the file. */
const rotated = 'Rotated {path}.';

export { loggingTo, rotated };
