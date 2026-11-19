/*
 * The phrases of an invocation by name's issues, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '../localization/phrase.js';
import * as sentences from './messages.js';

/** Says one sentence of `invocation/messages.ts` with its values. */
export const invocationPhrase = phrases('@loomcli/core').module('invocation', sentences);
