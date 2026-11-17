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

/** One log line: its message, a constant Message Template, and the fields it reads. */
interface LogText {
  readonly template: string;
  readonly fields: Readonly<Record<string, number | string>>;
}

/** The `debug` log line for a file that imported names, which counts them and names none. */
function imported(count: number, file: string): LogText {
  return count === single
    ? { fields: { count, file }, template: 'Imported {count} variable from {file}.' }
    : { fields: { count, file }, template: 'Imported {count} variables from {file}.' };
}

/** Why the plugin passed over a name a file assigns, in the order the reasons are tried. */
type SkipReason =
  | { readonly kind: 'except' }
  | { readonly kind: 'only' }
  | { readonly kind: 'set' }
  | { readonly kind: 'supplied'; readonly from: string };

/** The message of each reason that names no other file. */
const fixedReasons: Readonly<Record<Exclude<SkipReason['kind'], 'supplied'>, string>> = {
  except: 'Skipped {name} from {file}: on the except list.',
  only: 'Skipped {name} from {file}: not on the only list.',
  set: 'Skipped {name} from {file}: already set.',
};

/**
 * The `trace` log line for one name a file assigns that the plugin passed over, which never holds
 * a value.
 */
function skippedName(name: string, file: string, reason: SkipReason): LogText {
  return reason.kind === 'supplied'
    ? {
        fields: { file, name, specific: reason.from },
        template: 'Skipped {name} from {file}: already set from {specific}.',
      }
    : { fields: { file, name }, template: fixedReasons[reason.kind] };
}

export type { LogText, SkipReason };
export { fileUnreadable, imported, lineMalformed, skippedName };
