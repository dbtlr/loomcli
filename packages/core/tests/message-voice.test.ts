// @module-tag docs
/*
 * Core's voice test, under ADR-0164. Every sentence core says to an operator lives in a message
 * module beside the code that raises or writes it, and this test holds those modules to the banned
 * words of the voice page, rule 5's escaping, and rule 6's ban on outside text, and holds the rest of
 * core's sources to gathering. The reader's own test, `voice-reader.test.ts`, shows each check
 * report a bad sentence.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** Core's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** An issue's `message`, the line a value core's own code rejects prints after the input's name. */
const sinks: VoiceSinks = { properties: ['message'] };

/**
 * Core's known exceptions. An issue's sentence is its validator's, from the catalog or the author,
 * and core repeats it after the input's name as the validator wrote it, under
 * docs/core/validation.md's Issues and validator failures, so escaping it would change how a
 * multi-line issue prints.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'inputs/messages.ts': {
      '${issueSentence}': {
        reason:
          "An issue's sentence is its validator's, which core repeats as the validator wrote it.",
        sites: 3,
      },
    },
  },
};

test('every sentence core says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
