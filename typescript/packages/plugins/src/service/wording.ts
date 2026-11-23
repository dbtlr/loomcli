/*
 * The service plugin's log line for a manager call, the template of `messages.ts` with the field
 * it reads, under ADR-0200's wording modules. `tests/message-voice.test.ts` reads this module as a
 * message module.
 */
import type { Phrase } from '@loomcli/core';

import { servicePhrase } from './phrases.js';

/**
 * The `-v` line once a service manager call that started ends, whatever its code: the program and
 * its words joined by single spaces, each word kept whole, as a failure repeats the call.
 */
function ranCall(
  program: string,
  args: readonly string[],
): { readonly template: Phrase; readonly fields: { readonly call: string } } {
  return {
    fields: { call: [program, ...args].join(' ') },
    template: servicePhrase('ranManagerCall'),
  };
}

export { ranCall };
