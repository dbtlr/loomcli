/*
 * The phrases of core's input sentences and issues, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '../localization/phrase.js';
import * as sentences from './messages.js';

/** Says one sentence of `inputs/messages.ts` with its values. */
export const inputPhrase = phrases('@loomcli/core').module('inputs', sentences);
