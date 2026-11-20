/*
 * The phrases of the suggestions plugin's sentences, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence of `suggestions/messages.ts` with its values. */
export const suggestionsPhrase = phrases('@loomcli/plugins').module('suggestions', sentences);
