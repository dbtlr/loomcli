/*
 * The phrases of the format plugin's sentences, under ADR-0200: each names its export in
 * `messages.ts` and carries its values, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one sentence of `format/messages.ts` with its values. */
export const formatPhrase = phrases('@loomcli/plugins').module('format', sentences);
