/*
 * The phrases of the background plugin's sentences, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence of `background/messages.ts` with its values. */
export const backgroundPhrase = phrases('@loomcli/plugins').module('background', sentences);
