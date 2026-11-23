/*
 * The phrases of the dotenv plugin's sentences, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence of `dotenv/messages.ts` with its values. */
export const dotenvPhrase = phrases('@loomcli/plugins').module('dotenv', sentences);
