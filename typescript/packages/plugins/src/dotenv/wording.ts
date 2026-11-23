/*
 * The dotenv plugin's log lines, each a template of `messages.ts` with the fields it reads, under
 * ADR-0200's wording modules. `tests/message-voice.test.ts` reads this module as a message module.
 */
import type { Phrase } from '@loomcli/core';

import { dotenvPhrase } from './phrases.js';

const single = 1;

/** One log line: its message, a constant Message Template, and the fields it reads. */
interface LogText {
  readonly template: Phrase;
  readonly fields: Readonly<Record<string, number | string>>;
}

/** The `debug` log line for a file that imported names, which counts them and names none. */
function imported(count: number, file: string): LogText {
  return count === single
    ? { fields: { count, file }, template: dotenvPhrase('importedVariable') }
    : { fields: { count, file }, template: dotenvPhrase('importedVariables') };
}

/** Why the plugin passed over a name a file assigns, in the order the reasons are tried. */
type SkipReason =
  | { readonly kind: 'except' }
  | { readonly kind: 'only' }
  | { readonly kind: 'set' }
  | { readonly kind: 'supplied'; readonly from: string };

/** The message of each reason that names no other file. */
const fixedReasons: Readonly<Record<Exclude<SkipReason['kind'], 'supplied'>, Phrase>> = {
  except: dotenvPhrase('skippedExcepted'),
  only: dotenvPhrase('skippedNotOnly'),
  set: dotenvPhrase('skippedAlreadySet'),
};

/**
 * The `trace` log line for one name a file assigns that the plugin passed over, which never holds
 * a value.
 */
function skippedName(name: string, file: string, reason: SkipReason): LogText {
  return reason.kind === 'supplied'
    ? { fields: { file, name, specific: reason.from }, template: dotenvPhrase('skippedSetFrom') }
    : { fields: { file, name }, template: fixedReasons[reason.kind] };
}

export type { LogText, SkipReason };
export { imported, skippedName };
