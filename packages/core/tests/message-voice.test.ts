// @module-tag docs
/*
 * Core's voice test, under ADR-0164. Every sentence core says to an operator lives in a message
 * module beside the code that raises or writes it, and this test holds those modules to the banned
 * words of the voice page and rule 5's escaping, the rest of core's sources to gathering, and every
 * source file to rule 6's ban on outside text, so a caller's read is pinned with its reason. The
 * reader's own test, `voice-reader.test.ts`, shows each check report a bad sentence.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** Core's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** An issue's `message`, the line a value core's own code rejects prints after the input's name. */
const sinks: VoiceSinks = { properties: ['message'] };

/** A read that carries a cause on to a failure, or tests what it holds, and quotes nothing. */
const carried =
  'The cause is carried on to the failure that wraps it, or tested for what it is, and no sentence quotes it.';

/** A read of the message of a failure core raised, which core's views print. */
const ownFailure =
  "A failure's own message, worded in a message module, which core's default text and failure form print.";

/** A read of a validator's issue sentence, which core repeats after the input's name. */
const issue =
  "An issue's sentence is its validator's, which core repeats after the input's name as the validator wrote it.";

/**
 * Core's known exceptions. An issue's sentence is its validator's, from the catalog or the author,
 * and core repeats it after the input's name as the validator wrote it, under
 * docs/core/validation.md's Issues and validator failures, so escaping it would change how a
 * multi-line issue prints. Outside the message modules, core reads a failure's own message to print
 * it, an issue's sentence to repeat it, and a cause to carry it on, to classify it, or to show it
 * to the author in a Developer Diagnostic or a log record, which no operator sentence quotes.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'inputs/messages.ts': {
      '${issueSentence}': { reason: issue, sites: 3 },
    },
  },
  'outside-text': {
    'application/application.ts': { 'lineFault.cause': { reason: carried, sites: 1 } },
    'diagnostics/defect.ts': {
      'cause.cause': {
        reason:
          "A defect's cause chain, which a development build's Developer Diagnostic shows the author as evidence.",
        sites: 1,
      },
      'failure.cause': {
        reason:
          "A defect's cause, which the log record of a defect carries for the author; the operator reads the generic defect message.",
        sites: 1,
      },
    },
    'diagnostics/developer.ts': {
      'fault.cause': {
        reason:
          "A defect's cause, which a development build's Developer Diagnostic shows the author as evidence.",
        sites: 1,
      },
    },
    'failures/encoders.ts': { 'answer.cause': { reason: carried, sites: 1 } },
    'failures/errors.ts': {
      '?.cause': { reason: carried, sites: 1 },
      'failure.message': { reason: ownFailure, sites: 2 },
      'thrown.message': {
        reason:
          "reasonOf quotes a thrown value in a Developer Diagnostic's sentence, which addresses the author; a distributed build shows the operator the generic defect message.",
        sites: 1,
      },
      'value.cause': { reason: carried, sites: 1 },
    },
    'failures/form.ts': { 'failure.message': { reason: ownFailure, sites: 1 } },
    'inputs/context.ts': {
      'question.message': {
        reason: "A question's own message, the prompt the author declares, names the input.",
        sites: 1,
      },
    },
    'inputs/validation.ts': {
      'first?.message': { reason: issue, sites: 1 },
      'issue.message': { reason: issue, sites: 3 },
    },
    'inspection/inspect.ts': { 'failed.cause': { reason: carried, sites: 1 } },
    'output/log.ts': {
      'form.message': {
        reason:
          "A log event's message, which a logging plugin records and ADR-0047 counts as no operator message.",
        sites: 1,
      },
    },
    'output/output.ts': {
      'open.message': {
        reason:
          "An open streamed message's handle, which the output stops or waits for, not an error's text.",
        sites: 3,
      },
    },
    'output/sequence.ts': { 'error.cause': { reason: carried, sites: 2 } },
    'output/streamed.ts': { 'fault.cause': { reason: carried, sites: 1 } },
    'plugins/hints.ts': { 'report.cause': { reason: carried, sites: 1 } },
    'signals/signals.ts': { 'thrown.cause': { reason: carried, sites: 1 } },
  },
};

test('every sentence core says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
