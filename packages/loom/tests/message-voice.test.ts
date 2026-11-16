// @module-tag docs
/*
 * The `loom` bin's voice test, under ADR-0164. Each command's sentences, with those of the helpers
 * that serve it, live in `src/commands/<command>/messages.ts`, and the sentences every launch loads,
 * the declarations' issues and those of the helpers a declaration imports, in
 * `src/helpers/messages.ts`. This test holds those modules to the banned words of the voice page
 * and rule 5's escaping, the rest of the bin's sources to gathering, and every source file to rule
 * 6's ban on outside text, so a caller's read is pinned with its reason. The bin's `report()`
 * prints a thrown error's message through `out.fatal`, so JavaScript's own `Error` counts as a
 * failure constructor, and it prints what a command's work returns, so each `return` inside a
 * `report(...)` call, and a concise arrow body that is itself the call's argument, is the route a
 * command's confirmation takes, and so is each `return` and concise arrow body of a function that
 * call prints the result of.
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
  calls: ['lines.push', 'optionError', 'run.line'],
  classes: ['Error'],
  // The functions whose returned text a `report(...)` call prints.
  functions: [
    'cutSummary',
    'packageNotes',
    'prereleaseNotes',
    'recordRelease',
    'renderPlan',
    'stableNotes',
  ],
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
  'outside-text': {
    'application-load.ts': {
      'error.message': {
        reason:
          "A reader reports what the author's application module threw: a DeclarationError's own Developer Diagnostic, or the thrown value's reason, which loadFailure quotes in one.",
        sites: 2,
      },
    },
    'commands/init/init.ts': {
      'error.message': {
        reason:
          "unloadedApplication repeats the first line of the sentence the read of the author's application module failed with, which carries the error the module threw. A system error carries no such sentence, so it passes the general reason with its code instead.",
        sites: 1,
      },
    },
    'content/installer-script.ts': {
      'postInstall?.message': {
        reason:
          "The post-install message the author declares in the configuration file, which the installer prints; not an error's text.",
        sites: 1,
      },
    },
    'helpers/application-load-failure.ts': {
      '.message': {
        reason:
          "The text of the Developer Diagnostic the bin builds for a module that threw while it loaded, which quotes the author's module error.",
        sites: 1,
      },
    },
    'helpers/fragments.ts': {
      'error.message': {
        reason:
          "The bin's own sentence about each invalid fragment, gathered into one failure so a run reports them all. A system error carries no such sentence, so a fragment the reader cannot read is named with its code instead.",
        sites: 1,
      },
    },
    'helpers/http.ts': {
      'error.cause': {
        reason:
          'Tests whether a request failed on its timeout, which the runtime records as the cause; no sentence quotes it.',
        sites: 1,
      },
    },
    'helpers/parse-or-throw.ts': {
      'issue.message': {
        reason: "A schema issue's sentence, repeated after the dot path of its key.",
        sites: 2,
      },
    },
    'helpers/release-check.ts': {
      'error.message': {
        reason:
          "skillMissing repeats git's report, or the bin's own sentence about the authoring skill, such as the one for a git that cannot start, which ADR-0164 states.",
        sites: 1,
      },
    },
    'helpers/report.ts': {
      'error.message': {
        reason:
          "report() prints the message of a throw that is no system error, which is the bin's own sentence for every failure the bin raises. A system error is worded from its code, call, and path instead. A defect of the bin's own inputs prints a runtime's text, as ADR-0164 lists: a runtime error with an internal ERR_ code, a Bun metafile or the application reader's result file that is not JSON, or a GitHub upload address that is not a URL.",
        sites: 1,
      },
    },
    'helpers/shared-version.ts': {
      'error.message': {
        reason: "sharedFileUnparsed repeats the bin's own sentence that parseManifest throws.",
        sites: 1,
      },
    },
    'read-skills.ts': {
      'error.message': {
        reason:
          "skillsFolderJudged relays the plugin pack's judging of a skills folder, the fault its read raised.",
        sites: 1,
      },
    },
  },
};

test('every sentence the loom bin says to an operator keeps the voice the voice test holds', async () => {
  await expect(voiceReport(src, exceptions, sinks)).resolves.toEqual([]);
});
