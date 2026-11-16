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

const single = 1;

/** The `-v` line for a file that imported names, which counts them and names none. */
function imported(count: number, file: string): string {
  return count === single
    ? `Imported 1 variable from ${shown(file)}.`
    : `Imported ${String(count)} variables from ${shown(file)}.`;
}

/** Why the plugin passed over a name a file assigns, in the order the reasons are tried. */
type SkipReason =
  | { readonly kind: 'except' }
  | { readonly kind: 'only' }
  | { readonly kind: 'set' }
  | { readonly kind: 'supplied'; readonly from: string };

/** The clause of each reason that names no file. */
const fixedReasons: Readonly<Record<Exclude<SkipReason['kind'], 'supplied'>, string>> = {
  except: 'on the except list.',
  only: 'not on the only list.',
  set: 'already set.',
};

function reasonText(reason: SkipReason): string {
  return reason.kind === 'supplied'
    ? `already set from ${shown(reason.from)}.`
    : fixedReasons[reason.kind];
}

/** The `-vv` line for one name a file assigns that the plugin passed over, which never holds a value. */
function skippedName(name: string, file: string, reason: SkipReason): string {
  return `Skipped ${shown(name)} from ${shown(file)}: ${reasonText(reason)}`;
}

export type { SkipReason };
export { fileUnreadable, imported, lineMalformed, skippedName };
