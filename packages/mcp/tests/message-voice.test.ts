// @module-tag docs
/*
 * The MCP server's voice test, under ADR-0164. The plugin pack ships this server, and the error
 * text it returns to a client is an operator message, so every sentence of it lives in
 * `src/messages.ts`. This test holds that module to the banned words of the voice page, rule 5's
 * escaping, and rule 6's ban on outside text, and holds the rest of the package's sources to
 * gathering, where each `ProtocolError` counts as a failure constructor.
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
 * core, so its sentences repeat only what the server itself names, and a request id, which the
 * client chose and the server writes as JSON in its reply to that client.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'messages.ts': {
      '${capabilitiesKey}': { reason: ownConstant, sites: 1 },
      '${handshakes}': { reason: ownConstant, sites: 1 },
      '${id}': {
        reason:
          'A request id is the one the client sent, written as JSON, in the reply to that client.',
        sites: 1,
      },
      '${key}': { reason: ownConstant, sites: 1 },
      '${method}': { reason: ownConstant, sites: 1 },
      '${revision}': { reason: ownConstant, sites: 3 },
      '${versionKey}': { reason: ownConstant, sites: 1 },
    },
  },
};

test('every sentence the MCP server returns to a client keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions)).resolves.toEqual([]);
});
