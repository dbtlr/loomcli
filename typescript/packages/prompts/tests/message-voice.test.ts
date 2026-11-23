// @module-tag docs
/*
 * The prompts package's voice test, under ADR-0164. Every sentence a question or a progress line
 * says to an operator lives in `src/messages.ts`: a failure's sentence, the line a question shows
 * under an answer it rejects, and the sentence a progress line opens its kept lines with. This test
 * checks the message module's registry key and export shape under ADR-0200. It also checks wording,
 * escaping, and the routes a sentence takes to the operator, including an issue line, under
 * ADR-0164.
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
 * A question repeats the validator's issue and the view escapes the whole line when it draws it.
 * The progress style's schema checks a value stored by the package. The voice scan also sees the
 * question's own message, which the author supplied.
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
      '`\\n  ${style.error(`${glyph.cross} ${literal(issueSentence)}`)}`': {
        reason:
          "A view's issue line indents the escaped issue, so it holds no sentence of its own.",
        sites: 1,
      },
    },
  },
  'outside-text': {
    'editor.ts': {
      'settings.message': { reason: ownMessage, sites: 2 },
    },
    'index.ts': { 'settings.message': { reason: ownMessage, sites: 4 } },
    'list.ts': {
      'settings.message': { reason: ownMessage, sites: 9 },
    },
    'phrases.ts': { 'issue.message': { reason: issue, sites: 1 } },
    'question.ts': {
      'settings.message': { reason: ownMessage, sites: 3 },
    },
    'views.ts': { 'data.message': { reason: ownMessage, sites: 11 } },
  },
};

test('every sentence the prompts package says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks, 'registry.ts')).resolves.toEqual([]);
});
