/*
 * The phrases of the sentences several plugins share, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence of `src/messages.ts` with its values. */
export const commonPhrase = phrases('@loomcli/plugins').module('common', sentences);
