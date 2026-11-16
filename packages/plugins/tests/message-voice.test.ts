// @module-tag docs
/*
 * The plugin pack's voice test, under ADR-0164. Every sentence a plugin says to an operator lives
 * in the `messages.ts` of its folder, and the files at the top of `src`, which several plugins
 * share, keep theirs in `src/messages.ts`. This test holds those modules to the banned words of the
 * voice page, rule 5's escaping, and rule 6's ban on outside text, and holds the rest of the pack's
 * sources to gathering. An issue's `message`, which a validator or a value an option cannot take
 * reports, and the text of a tool execution error the MCP plugin's server returns, are routes a
 * sentence takes to the operator too.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** The pack's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** An issue's `message`, and the MCP server's `text(...)` content of a tool execution error. */
const sinks: VoiceSinks = { calls: ['text'], properties: ['message'] };

const textRule =
  "A text rule's sentence is an extension schema's refusal, which addresses the author under a Developer Diagnostic.";

/**
 * The pack's known exceptions. An issue's sentence is its validator's, which the configuration
 * plugin repeats after the option's name as the validator wrote it, as core does, under
 * docs/core/validation.md's Issues and validator failures. A text rule's sentence refuses a fact an
 * author declares on a Command or a plugin, so it never reaches an operator.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'config/messages.ts': {
      '${issueSentence}': {
        reason:
          "An issue's sentence is its validator's, which the plugin repeats as the validator wrote it.",
        sites: 2,
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
};

test('every sentence the plugin pack says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
