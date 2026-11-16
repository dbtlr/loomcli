// @module-tag docs
/*
 * The validators package's voice test, under ADR-0164. Every catalog sentence lives in
 * `src/messages.ts`, and each public issue code in `src/codes.ts` calls one. This test holds the
 * message module to the banned words of the voice page and rule 5's escaping, the rest of the
 * package's sources to gathering, reading an issue code's `message` member as a route a sentence
 * takes to the operator, and every source file to rule 6's ban on outside text.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** The package's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** An issue's `message`, which core prints after the input's name, is the catalog's own route. */
const sinks: VoiceSinks = { properties: ['message'] };

const formatted =
  'A bound formatted from a number the parameter schema accepts reads only digits, unit letters, and separators.';

/**
 * The package's known exceptions. A formatted bound is a number written in the sentence's units,
 * which the scanner cannot type. A parameter schema's refusal addresses the author who passes
 * parameters to `issue()`, whose Developer Diagnostic reports it, and never reaches an operator.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'messages.ts': {
      '${formatBytes(max)}': { reason: formatted, sites: 2 },
      '${formatBytes(min)}': { reason: formatted, sites: 2 },
      '${formatDuration(max)}': { reason: formatted, sites: 2 },
      '${formatDuration(min)}': { reason: formatted, sites: 2 },
      '${formatTimeOfDay(max)}': { reason: formatted, sites: 2 },
      '${formatTimeOfDay(min)}': { reason: formatted, sites: 2 },
    },
  },
  gathering: {
    'params.ts': {
      '`Expected the parameters ${shape}.`': {
        reason:
          "A parameter schema's refusal addresses the author who calls issue(), under a Developer Diagnostic.",
        sites: 1,
      },
    },
  },
};

test('every sentence the validators package says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
