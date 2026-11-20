/*
 * The phrases of the service plugin's sentences, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence of `service/messages.ts` with its values. */
export const servicePhrase = phrases('@loomcli/plugins').module('service', sentences);
