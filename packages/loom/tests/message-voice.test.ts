// @module-tag docs
/*
 * The `loom` bin's voice test, under ADR-0164. Every sentence the bin says to an operator lives in
 * `src/helpers/messages.ts`, its commands' sentences included, because a run loads no module under
 * `src/commands` beyond the declarations and the routed command's own work. This test holds that
 * module to the banned words of the voice page, rule 5's escaping, and rule 6's ban on outside
 * text, and holds the rest of the bin's sources to gathering. The bin's
 * `report()` prints a thrown error's message through `out.fatal`, so JavaScript's own `Error`
 * counts as a failure constructor, an issue's `message` is the line a rejected value prints, and the
 * `failure` an application reader answers is a sentence the bin prints.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** The bin's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** The routes the bin's sentences take beside failure constructors and out calls. */
const sinks: VoiceSinks = {
  calls: ['optionError'],
  classes: ['Error'],
  properties: ['failure', 'message'],
};

/**
 * The bin's known exceptions. A sentence that repeats what another program, a service, or another
 * failure wrote, such as Bun's build output, git's stderr, or a plugin's fault, repeats it whole as
 * `output`, its lines included, so the operator reads that report as its writer laid it out. An
 * application reader runs with no copy of core and words nothing through a message module, and its
 * one sentence of its own refuses arguments only the bin's own spawn passes.
 */
const exceptions: VoiceExceptions = {
  escaping: {
    'helpers/messages.ts': {
      '${output}': {
        reason:
          'Text another program, a service, or another failure wrote is repeated whole, its lines included.',
        sites: 9,
      },
    },
  },
  gathering: {
    'application-load.ts': {
      '`${reader} takes a result file, a package directory, a module, and its name.`': {
        reason:
          "A reader bundles no message module, and only the bin's own spawn, which passes every argument, runs it.",
        sites: 1,
      },
    },
  },
};

test('every sentence the loom bin says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
