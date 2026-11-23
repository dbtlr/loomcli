/*
 * The phrases of core's plugin sentences, under ADR-0200: each names its export in `messages.ts`, so
 * core renders it in the run's language.
 */
import { phrases } from '../localization/phrase.js';
import * as sentences from './messages.js';

/** Says one sentence of `plugins/messages.ts`. */
export const pluginPhrase = phrases('@loomcli/core').module('plugins', sentences);
