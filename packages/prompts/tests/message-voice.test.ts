// @module-tag docs
/*
 * The prompts package's voice test, under ADR-0164. Every sentence a question says to an operator
 * lives in `src/messages.ts`: a failure's sentence, and the line a question shows under an answer
 * it rejects. This test holds the message module to the banned words of the voice page and rule 5's
 * escaping, the rest of the package's sources to gathering, reading the issue line a question
 * assigns, and an issue's `message`, as routes a sentence takes to the operator, and every source
 * file to rule 6's ban on outside text.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** The package's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** A question shows the line it assigns to `issue`, and a validator's issue its `message`. */
const sinks: VoiceSinks = { assignments: ['issue'], properties: ['message'] };

/** A read of a validator's issue sentence, which a question shows under the answer it rejects. */
const issue =
  "An issue's sentence is its validator's, which the question repeats and the view escapes.";

/** A read of a question's own `message` setting, which is no error's text. */
const ownMessage =
  "A question's own message, the prompt the author declares and the view draws, not an error's text.";

/**
 * The package's known exceptions. An issue's sentence is its validator's, which a question repeats
 * as the validator wrote it, and the view escapes the whole line when it draws it. A view's issue
 * line indents the escaped issue under the frame, so its literal holds spaces and no sentence. The
 * progress style's schema refuses a value only the package stores, which no operator supplies.
 * Outside the message module, a question reads an issue's sentence to show it, and its own
 * `message` setting, the prompt it asks, which the scan cannot tell from an error's text.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'messages.ts': {
      '${issueSentence}': { reason: issue, sites: 1 },
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
  'outside-text': {
    'editor.ts': {
      '?.message': { reason: issue, sites: 1 },
      'settings.message': { reason: ownMessage, sites: 2 },
    },
    'index.ts': { 'settings.message': { reason: ownMessage, sites: 4 } },
    'list.ts': {
      '?.message': { reason: issue, sites: 1 },
      'settings.message': { reason: ownMessage, sites: 9 },
    },
    'question.ts': {
      '?.message': { reason: issue, sites: 2 },
      'settings.message': { reason: ownMessage, sites: 3 },
    },
    'views.ts': { 'data.message': { reason: ownMessage, sites: 11 } },
  },
};

test('every sentence the prompts package says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
