// @module-tag docs
/*
 * The `loom` bin's voice test, under ADR-0164. Each command's sentences, with those of the helpers
 * that serve it, live in `src/commands/<command>/messages.ts`, and the sentences every launch loads,
 * the declarations' issues and those of the helpers a declaration imports, in
 * `src/helpers/messages.ts`. This test holds those modules to the banned words of the voice page,
 * rule 5's escaping, and rule 6's ban on outside text, and holds the rest of the bin's sources to
 * gathering. The bin's `report()` prints a thrown error's message through `out.fatal`, so
 * JavaScript's own `Error` counts as a failure constructor, and it prints what a command's work
 * returns, so each `return` or concise arrow body inside a `report(...)` call is the route a
 * command's confirmation takes, and so is each `return` of a function that call prints the result of.
 * An issue's `message` is the line a rejected value prints, the `failure` an application reader
 * answers is a sentence the bin prints, and `run.line(...)` writes each line `loom init` prints for
 * a file it writes.
 */
import { expect, test } from 'vite-plus/test';

import { voiceReport } from '../../../scripts/test-voice.js';
import type { VoiceExceptions, VoiceSinks } from '../../../scripts/test-voice.js';

/** The bin's sources, which every check reads. */
const src = new URL('../src/', import.meta.url);

/** The routes the bin's sentences take beside failure constructors and out calls. */
const sinks: VoiceSinks = {
  calls: ['optionError', 'run.line'],
  classes: ['Error'],
  // The functions whose returned text a `report(...)` call prints.
  functions: ['cutSummary', 'packageNotes', 'recordRelease', 'renderPlan'],
  properties: ['failure', 'message'],
  returns: ['report'],
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
    'commands/build/messages.ts': {
      '${output}': {
        reason:
          "bunCouldNotRead and bunBuildFailed repeat Bun's own report, and skillsFolderJudged the plugin pack's judging of a skills folder, whole, its lines included.",
        sites: 3,
      },
    },
    'commands/pr/messages.ts': {
      '${output}': {
        reason:
          "skillMissing repeats git's report or the bin's own sentence about the file, skillInvalidYaml the YAML parser's report, and skillVersionUnset the bin's own sentence about the frontmatter, whole.",
        sites: 3,
      },
    },
    'commands/release/messages.ts': {
      '${output}': {
        reason:
          "lockfilePreparationFailed repeats pnpm's output, and refusedRequest the body of a GitHub or registry response, whole, its lines included.",
        sites: 2,
      },
    },
    'helpers/messages.ts': {
      '${output}': {
        reason: "gitFailed repeats git's own report on stderr whole, its lines included.",
        sites: 1,
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
