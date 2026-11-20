import { questionValidationOptions } from '@loomcli/core';
import type { Phrase, Region, StandardSchemaV1 } from '@loomcli/core';

import { controls, hideCursor, pasteOff, showCursor } from './controls.js';
import { TypedLine, graphemes } from './line.js';
import { askLineByLine } from './lines.js';
import { promptPhrase, rejection } from './phrases.js';
import { openReader } from './reader.js';
import type { PromptContext } from './types.js';
import { withHint, withIssue } from './view-text.js';
import { answeredLine, cancelledLine, questionFrame } from './views.js';
import type { QuestionFrame } from './views.js';

/**
 * A confirm question's legend, whose capital letter is the prefill: `Y/n`, `y/N`, or `y/n`. Its
 * letters are the keys the answer accepts, which no locale changes, so it is no phrasebook entry.
 */
function confirmLegend(hint: string | undefined): string {
  if (hint === 'yes') {
    return 'Y/n';
  }
  return hint === 'no' ? 'y/N' : 'y/n';
}

/** Opens the key reader for a live region, ending the region when the reader cannot open. */
function liveReader<Options>(context: PromptContext<Options>, region: Region) {
  try {
    return openReader(context);
  } catch (error) {
    void region.end();
    throw error;
  }
}
function displayAnswer(kind: string, raw: string, value: unknown): string | undefined {
  if (kind === 'secret') {
    return undefined;
  }
  if (kind === 'confirm') {
    return promptPhrase(value ? 'yesAnswer' : 'noAnswer').text;
  }
  return raw;
}

/**
 * The input region one question draws in. Core erases and redraws it around every other write and
 * opens one input region at a time, so the first frame resolves once this question's turn has
 * come. When core closes the region, for a cancellation, a failure, or the return of what opened
 * it, the question draws its cancelled line as the region's last frame, and its reading ends: the
 * run's signal ends it for a cancellation, and the region's signal for a failure or a return.
 */
function asking<Options>(
  context: PromptContext<Options>,
  question: { readonly message: string; readonly kind: QuestionFrame['kind'] },
  held: { readonly reader: { abandon: (reason: unknown) => void }; readonly region: Region },
) {
  const { reader, region } = held;
  const { message, kind } = question;
  region.signal.addEventListener(
    'abort',
    () => {
      if (region.closedBy === 'end') {
        return;
      }
      void region.draw({ message }, cancelledLine);
      if (region.closedBy !== 'cancellation') {
        reader.abandon(region.signal.reason);
      }
    },
    { once: true },
  );
  let hidden = false;
  let lent = false;
  // A suspend shows the cursor before the process stops, so the resume hides it again.
  let unhide: (() => void) | undefined = undefined;
  return {
    /**
     * The answered or cancelled line, then the region's close and the cursor shown again, with
     * bracketed paste turned off when the run's last open question has `released` stdin.
     */
    async finish(
      answer: { value: string | undefined; lines?: number } | undefined,
      released: boolean,
    ) {
      unhide?.();
      try {
        if (region.closedBy === undefined) {
          await (answer
            ? region.draw(
                {
                  answer: answer.value,
                  kind,
                  message,
                  ...(answer.lines === undefined ? {} : { lines: answer.lines }),
                },
                answeredLine,
              )
            : region.draw({ message }, cancelledLine));
          await region.end();
        }
      } finally {
        await context.out.draw(showCursor + (released ? pasteOff : ''), controls);
      }
    },
    async frame(data: QuestionFrame) {
      await region.draw(data, questionFrame);
      if (!hidden) {
        hidden = true;
        unhide = context.onResume(() => {
          if (!lent) {
            void context.out.draw(hideCursor, controls);
          }
        });
        await context.out.draw(hideCursor, controls);
      }
    },
    lend(value: boolean) {
      lent = value;
    },
    signal: region.signal,
  };
}

/** Text and editor submissions share the same validation context and unchanged fallback answer. */
async function validateAnswer<Options, Output>(
  context: PromptContext<Options>,
  settings: { message: string; validate?: StandardSchemaV1<string, Output> } & (
    | { option?: string; argument?: never }
    | { argument: string; option?: never }
  ),
  raw: string,
) {
  return settings.validate === undefined
    ? { issues: undefined, value: raw }
    : await settings.validate['~standard'].validate(
        raw,
        questionValidationOptions(context, settings),
      );
}

/** One text reader serves text and secret; only the submitted value reaches validation. */
async function askText<Options, Output>(
  context: PromptContext<Options>,
  settings: {
    message: string;
    kind: 'text' | 'secret' | 'confirm';
    hint: string | undefined;
    validate?: StandardSchemaV1<string, Output>;
  } & ({ option?: string; argument?: never } | { argument: string; option?: never }),
): Promise<string | Output> {
  // A region that is not live is a terminal that does not move its cursor, so it asks line by line.
  const region = context.out.region({ input: true });
  if (!region.live) {
    return askTextLines(context, settings, region);
  }
  // Raw mode holds from here, and the first frame resolves once this question's turn has come.
  const reader = liveReader(context, region);
  const draw = asking(context, settings, { reader, region });
  const line = new TypedLine();
  let issue: string | Phrase | undefined = undefined;
  let answered: { value: string | undefined } | undefined = undefined;
  const confirm = settings.kind === 'confirm';
  const hint = confirm ? confirmLegend(settings.hint) : settings.hint;
  const frame = () =>
    draw.frame(
      withIssue(
        withHint(
          {
            cursor: settings.kind === 'secret' ? 0 : line.cursor,
            hint: undefined,
            issue: undefined,
            kind: settings.kind,
            message: settings.message,
            typed: settings.kind === 'secret' ? '' : line.value,
          },
          hint,
          confirm,
        ),
        issue,
      ),
    );
  try {
    await frame();
    while (true) {
      const key = await reader.read();
      if (key.kind === 'eof' && line.value === '') {
        context.cancel();
        context.signal.throwIfAborted();
      }
      if (key.kind === 'enter') {
        const raw = line.value === '' ? (settings.hint ?? '') : line.value;
        const result = await validateAnswer(context, settings, raw);
        context.signal.throwIfAborted();
        if (result.issues === undefined) {
          if (settings.kind === 'secret') {
            reader.discard();
          }
          answered = {
            value: displayAnswer(settings.kind, raw, result.value),
          };
          return result.value;
        }
        issue = rejection(result.issues);
        await frame();
      } else {
        if (
          settings.kind === 'text' &&
          line.value === '' &&
          (key.kind === 'tab' || key.kind === 'right') &&
          settings.hint !== undefined
        ) {
          line.value = settings.hint;
          line.cursor = graphemes(line.value).length;
        } else {
          line.edit(key.kind, key.kind === 'text' || key.kind === 'paste' ? key.value : '');
        }
        if (settings.kind !== 'secret') {
          await frame();
        }
      }
    }
  } finally {
    await draw.finish(answered, reader.close());
  }
}

/**
 * Asks a text, secret, or confirm question line by line: its asking row, `Project name [my-app]: `,
 * then the line the operator enters, where Enter alone takes the prefill. A rejected answer
 * prints its sentence and the asking row again. A secret echoes nothing of what it reads.
 */
async function askTextLines<Options, Output>(
  context: PromptContext<Options>,
  settings: {
    message: string;
    kind: 'text' | 'secret' | 'confirm';
    hint: string | undefined;
    validate?: StandardSchemaV1<string, Output>;
  } & ({ option?: string; argument?: never } | { argument: string; option?: never }),
  region: Region,
): Promise<string | Output> {
  const secret = settings.kind === 'secret';
  return askLineByLine(context, { message: settings.message, region }, async (line) => {
    const row = () =>
      line.print(
        withHint(
          { hint: undefined, kind: settings.kind, message: settings.message },
          settings.kind === 'confirm' ? confirmLegend(settings.hint) : settings.hint,
        ),
      );
    line.reasking(row);
    await row();
    while (true) {
      const typed = await line.read(secret);
      const raw = typed === '' ? (settings.hint ?? '') : typed;
      const result = await validateAnswer(context, settings, raw);
      line.signal.throwIfAborted();
      if (result.issues === undefined) {
        if (secret) {
          line.discardRest();
        }
        return result.value;
      }
      await line.reject(rejection(result.issues));
      await row();
    }
  });
}

export { asking, askText, liveReader, validateAnswer };
