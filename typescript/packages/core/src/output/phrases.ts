/*
 * The phrases of core's output sentences, under ADR-0200: each names its export in `messages.ts`
 * and carries its values, so core renders it in the run's language.
 */
import { phrases } from '../localization/phrase.js';
import * as sentences from './messages.js';

/** Says one sentence of `output/messages.ts` with its values. */
export const outputPhrase = phrases('@loomcli/core').module('output', sentences);
