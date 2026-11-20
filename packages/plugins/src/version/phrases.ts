/*
 * The phrases of the version plugin's labels, under ADR-0200: each names its export in
 * `messages.ts`, so core renders it in the run's language.
 */
import { phrases } from '@loomcli/core';

import * as sentences from './messages.js';

/** Says one label of `version/messages.ts`. */
export const versionPhrase = phrases('@loomcli/plugins').module('version', sentences);
