// @module-tag docs
/*
 * The plugin pack's voice test, under ADR-0164. Every sentence a plugin says to an operator lives
 * in the `messages.ts` of its folder, and the files at the top of `src`, which several plugins
 * share, keep theirs in `src/messages.ts`. This test holds those modules to the banned words of the
 * voice page and rule 5's escaping, the rest of the pack's sources to gathering, and every source
 * file to rule 6's ban on outside text, so a caller's read is pinned with its reason. An issue's
 * `message`, which a validator or a value an option cannot take reports, the text of a tool
 * execution error the MCP plugin's server returns, and the sentence self-update's `fatal(...)` and
 * `conflict(...)` and the skills plugin's `directoryProblem(...)` each wrap in a failure, are routes
 * a sentence takes to the operator too.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** The pack's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/**
 * An issue's `message`, the MCP server's `text(...)` content of a tool execution error, and the
 * plugins' own wrappers that build a failure around a sentence.
 */
const sinks: VoiceSinks = {
  calls: ['conflict', 'directoryProblem', 'fatal', 'text'],
  properties: ['message'],
};

const textRule =
  "A text rule's sentence is an extension schema's refusal, which addresses the author under a Developer Diagnostic.";

/** A read of a validator's issue sentence, which the configuration plugin repeats. */
const issue =
  "An issue's sentence is its validator's, which the plugin repeats after the option's name as the validator wrote it.";

/** A read that carries a cause on to a failure and quotes nothing. */
const carried = 'The cause is carried on to the failure that wraps it, and no sentence quotes it.';

/** A read of a text rule's own sentence, which is no error's text. */
const ruleSentence = `A text rule's own sentence, not an error's text. ${textRule}`;

/**
 * The pack's known exceptions. An issue's sentence is its validator's, which the configuration
 * plugin repeats after the option's name as the validator wrote it, as core does, under
 * docs/core/validation.md's Issues and validator failures. A text rule's sentence refuses a fact an
 * author declares on a Command or a plugin, so it never reaches an operator. Outside the message
 * modules, the pack reads an issue's sentence to repeat it, a failure's own message to print it, a
 * text rule's sentence, a log event's text, and a cause to carry it on.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'config/messages.ts': {
      '${issueSentence}': { reason: issue, sites: 1 },
      '${noFileFound}': {
        reason:
          'The fixed `-v` sentence the module declares, which the notice opens with and which repeats no value.',
        sites: 1,
      },
    },
  },
  gathering: {
    'lines.ts': {
      "'Supply Markdown that holds a character other than whitespace.'": {
        reason: textRule,
        sites: 1,
      },
      "'Supply one line that holds a character other than whitespace.'": {
        reason: textRule,
        sites: 1,
      },
      "'Supply prose whose every line holds a character other than whitespace.'": {
        reason: textRule,
        sites: 1,
      },
    },
  },
  'outside-text': {
    'config/drop.ts': {
      '?.message': {
        reason:
          "The schema's issue sentence, quoted in the Developer Diagnostic that tells the author the configuration schema rejects an empty file.",
        sites: 1,
      },
      'issue.message': { reason: issue, sites: 1 },
    },
    'config/shared.ts': { 'removal.message': { reason: issue, sites: 2 } },
    'config/source.ts': { 'issue.message': { reason: issue, sites: 2 } },
    'help/extension.ts': {
      'lineRule.message': { reason: ruleSentence, sites: 1 },
      'markdownRule.message': { reason: ruleSentence, sites: 1 },
    },
    'logging/error.ts': { 'detail.cause': { reason: carried, sites: 1 } },
    'logging/otel.ts': {
      'defect.message': {
        reason:
          "Core's defect detail is exported as the exception message, not worded as an operator sentence.",
        sites: 1,
      },
      'defect.stack': {
        reason:
          "Core's defect stack is exported as exception detail, not worded as an operator sentence.",
        sites: 2,
      },
      'event.message': {
        reason: "A log event's template is exported unchanged as the OpenTelemetry body.",
        sites: 1,
      },
    },
    'logging/record.ts': {
      'event.message': {
        reason:
          "A log event's template, written unchanged into its log record; core renders it at -v under ADR-0174.",
        sites: 1,
      },
    },
    'manifest/extension.ts': {
      'lineRule.message': { reason: ruleSentence, sites: 1 },
      'markdownRule.message': { reason: ruleSentence, sites: 1 },
    },
    'mcp/extension.ts': { 'proseRule.message': { reason: ruleSentence, sites: 1 } },
    'refresh.ts': {
      'error.message': {
        reason:
          "The error's message is a field of the refresh's warn log event, recorded and shown at -v under ADR-0174's narrowing of ADR-0047.",
        sites: 1,
      },
    },
    'self-update/plugin.ts': {
      'blocked.cause': { reason: carried, sites: 1 },
      'error.cause': { reason: carried, sites: 1 },
    },
    'self-update/request.ts': { 'options.cause': { reason: carried, sites: 1 } },
    'skills/extension.ts': { 'markdownRule.message': { reason: ruleSentence, sites: 1 } },
    'suggestions/plugin.ts': {
      'failure.message': {
        reason:
          "A failure's own message, which the suggestions view prints as core's default text does when it recorded no sentence, and whose individual issue sentences it replaces when it recorded a value suggestion.",
        sites: 2,
      },
      'issue.message': {
        reason:
          "The validator issue sentence, which the suggestions hook reads to locate and replace its line in core's failure text.",
        sites: 1,
      },
    },
  },
};

test('every sentence the plugin pack says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
