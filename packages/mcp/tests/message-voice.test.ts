// @module-tag docs
/*
 * The MCP server's voice test, under ADR-0164. The plugin pack ships this server, and the error
 * text it returns to a client is an operator message, so every sentence of it lives in
 * `src/messages.ts`. This test holds that module to the banned words of the voice page and rule 5's
 * escaping, the rest of the package's sources to gathering, where each `ProtocolError` counts as a
 * failure constructor, and every source file to rule 6's ban on outside text.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions } from '../../../scripts/test-voice.js';

/** The package's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

const ownConstant =
  "A protocol revision, a meta key, and a served method's name are the server's own constants, which hold no control character.";

/**
 * The package's known exceptions. The package bundles into the plugin pack with no dependency on
 * core, so its sentences repeat only what the server itself names.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'messages.ts': {
      '${capabilitiesKey}': { reason: ownConstant, sites: 1 },
      '${handshakes}': { reason: ownConstant, sites: 1 },
      '${key}': { reason: ownConstant, sites: 1 },
      '${method}': { reason: ownConstant, sites: 1 },
      '${revision}': { reason: ownConstant, sites: 3 },
      '${versionKey}': { reason: ownConstant, sites: 1 },
    },
  },
  'outside-text': {
    'json-rpc.ts': {
      'error.message': {
        reason:
          "A ProtocolError's own message, which the server's message module words, written as the message of the JSON-RPC error response.",
        sites: 1,
      },
    },
  },
};

test('every sentence the MCP server returns to a client keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions)).resolves.toEqual([]);
});
