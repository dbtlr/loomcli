/*
 * The phrases of the completion plugin's sentences, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence of `completion/messages.ts` with its values. */
export const completionPhrase = phrases('@loomcli/plugins').module('completion', sentences);
