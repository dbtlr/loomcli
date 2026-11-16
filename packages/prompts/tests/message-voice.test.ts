// @module-tag docs
/*
 * The prompts package's voice test, under ADR-0164. Every sentence a question says to an operator
 * lives in `src/messages.ts`: a failure's sentence, and the line a question shows under an answer
 * it rejects. This test holds the message module to the banned words of the voice page, rule 5's
 * escaping, and rule 6's ban on outside text, and holds the rest of the package's sources to
 * gathering, reading the issue line a question assigns, and an issue's `message`, as routes a
 * sentence takes to the operator.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** The package's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** A question shows the line it assigns to `issue`, and a validator's issue its `message`. */
const sinks: VoiceSinks = { assignments: ['issue'], properties: ['message'] };

/**
 * The package's known exceptions. An issue's sentence is its validator's, which a question repeats
 * as the validator wrote it, and the view escapes the whole line when it draws it. A view's issue
 * line indents the escaped issue under the frame, so its literal holds spaces and no sentence. The
 * progress style's schema refuses a value only the package stores, which no operator supplies.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'messages.ts': {
      '${issueSentence}': {
        reason:
          "An issue's sentence is its validator's, which the question repeats and the view escapes.",
        sites: 1,
      },
    },
  },
  gathering: {
    'progress.ts': {
      "'Expected the style progressStyle() stores.'": {
        reason: "The extension's schema reads a style only the package stores on the root Command.",
        sites: 1,
      },
    },
    'views.ts': {
      '`\\n  ${style.error(`${glyph.cross} ${literal(data.issue)}`)}`': {
        reason:
          "A view's issue line indents the escaped issue, so it holds no sentence of its own.",
        sites: 1,
      },
    },
  },
};

test('every sentence the prompts package says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
