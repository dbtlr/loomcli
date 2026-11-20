/*
 * The operator sentences of the dotenv plugin, under ADR-0164. `tests/message-voice.test.ts` holds
 * this module to the failure message voice.
 */
import { escapeControlCharacters } from '@loomcli/core';

const shown = escapeControlCharacters;

function fileUnreadable(file: string): string {
  return `Skipped ${shown(file)}: the file could not be read. Make it readable, or remove it.`;
}

function lineMalformed(name: string, line: number, file: string): string {
  return `Skipped ${shown(name)} on line ${String(line)} of ${shown(file)}: the line is not a valid assignment. Correct the line, or remove it.`;
}

/** The `debug` log template for a file that imported one name, which names none. */
const importedVariable = 'Imported {count} variable from {file}.';

/** The `debug` log template for a file that imported several names, which names none. */
const importedVariables = 'Imported {count} variables from {file}.';

/** The `trace` log template for a name on the except list. */
const skippedExcepted = 'Skipped {name} from {file}: on the except list.';

/** The `trace` log template for a name not on the only list. */
const skippedNotOnly = 'Skipped {name} from {file}: not on the only list.';

/** The `trace` log template for a name the environment already sets. */
const skippedAlreadySet = 'Skipped {name} from {file}: already set.';

/** The `trace` log template for a name an earlier file already set. */
const skippedSetFrom = 'Skipped {name} from {file}: already set from {specific}.';

export {
  fileUnreadable,
  importedVariable,
  importedVariables,
  lineMalformed,
  skippedAlreadySet,
  skippedExcepted,
  skippedNotOnly,
  skippedSetFrom,
};
