import { questionValidationOptions } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

import { controls, hideCursor, pasteOff, showCursor } from './controls.js';
import { TypedLine, graphemes } from './line.js';
import { openReader } from './reader.js';
import type { PromptContext } from './types.js';
import { answeredLine, cancelledLine, questionFrame } from './views.js';
import type { QuestionFrame } from './views.js';

function confirmHint(hint: string | undefined): string {
  if (hint === 'yes') {
    return '[Y/n]';
  }
  return hint === 'no' ? '[y/N]' : '[y/n]';
}
function displayAnswer(kind: string, raw: string, value: unknown): string | undefined {
  if (kind === 'secret') {
    return undefined;
  }
  if (kind === 'confirm') {
    return value ? 'yes' : 'no';
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
  reader: { abandon: (reason: unknown) => void },
) {
  const { message, kind } = question;
  const region = context.out.region({ input: true });
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
  // Raw mode holds from here, and the first frame resolves once this question's turn has come.
  const reader = openReader(context);
  const draw = asking(context, settings, reader);
  const line = new TypedLine();
  let issue: string | undefined = undefined;
  let answered: { value: string | undefined } | undefined = undefined;
  const frame = () =>
    draw.frame({
      cursor: settings.kind === 'secret' ? 0 : line.cursor,
      hint: settings.kind === 'confirm' ? confirmHint(settings.hint) : settings.hint,
      issue,
      kind: settings.kind,
      message: settings.message,
      typed: settings.kind === 'secret' ? '' : line.value,
    });
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
        issue = result.issues[0]?.message ?? 'The answer is invalid.';
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

export { asking, askText, validateAnswer };
