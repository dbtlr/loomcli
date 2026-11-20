/*
 * The phrases of the help plugin's sentences and labels, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence or label of `help/messages.ts` with its values. */
export const helpPhrase = phrases('@loomcli/plugins').module('help', sentences);
