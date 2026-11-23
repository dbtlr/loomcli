/*
 * The phrases of core's failure sentences, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '../localization/phrase.js';
import * as sentences from './messages.js';

/** Says one sentence of `failures/messages.ts` with its values. */
export const failurePhrase = phrases('@loomcli/core').module('failures', sentences);
