/*
 * The external-commands plugin's log lines, each a template of `messages.ts` with the fields it
 * reads, under ADR-0200's wording modules. `tests/message-voice.test.ts` reads this module as a
 * message module.
 */
import { escapeControlCharacters } from '@loomcli/core';
import type { Phrase } from '@loomcli/core';

import { externalCommandsPhrase } from './phrases.js';

const shown = escapeControlCharacters;

/** One log line: its message, a constant Message Template, and the fields it reads. */
interface LogText {
  readonly template: Phrase;
  readonly fields: Readonly<Record<string, string>>;
}

/** The `debug` line for the program the plugin starts. */
function running(program: string): LogText {
  return {
    fields: { program: shown(program) },
    template: externalCommandsPhrase('runningProgram'),
  };
}

/** The `trace` line for one `PATH` entry the search passed over. */
function notIn(program: string, folder: string): LogText {
  return {
    fields: { folder: shown(folder), program: shown(program) },
    template: externalCommandsPhrase('programNotIn'),
  };
}

export type { LogText };
export { notIn, running };
