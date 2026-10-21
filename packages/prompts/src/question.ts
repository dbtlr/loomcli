import { questionValidationOptions } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';

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
function backspace(text: string): string {
  const segments = new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text);
  let end = 0;
  for (const segment of segments) {
    end = segment.index;
  }
  return text.slice(0, end);
}

/** The bare view the cursor sequences draw through, which nothing overrides. */
const controls = { render: (text: string) => text };
const hideCursor = '\u001b[?25l';
const showCursor = '\u001b[?25h';

/** Most choices a select shows at once, and the rows its title, key help, and markers need. */
const MAX_VISIBLE = 7;
const FRAME_CHROME = 4;

/**
 * The input region one question draws in. Core erases and redraws it around every other write and
 * opens one input region at a time, so the first frame resolves once this question's turn has
 * come. When core closes the region, for a cancellation, a failure, or the return of what opened
 * it, the question draws its cancelled line as the region's last frame, and its reading ends: the
 * run's signal ends it for a cancellation, and the region's signal for a failure or a return.
 */
function asking<Options>(
  context: PromptContext<Options>,
  message: string,
  reader: { abandon: (reason: unknown) => void },
) {
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
  return {
    /** The answered or cancelled line, then the region's close and the cursor shown again. */
    async finish(answer: { value: string | undefined } | undefined) {
      try {
        if (region.closedBy === undefined) {
          await (answer
            ? region.draw({ answer: answer.value, message }, answeredLine)
            : region.draw({ message }, cancelledLine));
          await region.end();
        }
      } finally {
        await context.out.draw(showCursor, controls);
      }
    },
    async frame(data: QuestionFrame) {
      await region.draw(data, questionFrame);
      if (!hidden) {
        hidden = true;
        await context.out.draw(hideCursor, controls);
      }
    },
  };
}

/** One text reader serves text and secret; only the submitted value reaches validation. */
async function askText<Options, Output>(
  context: PromptContext<Options>,
  settings: {
    message: string;
    kind: 'text' | 'secret' | 'confirm';
    hint: string | undefined;
    validate?: StandardSchemaV1<string, Output>;
    option?: string;
  },
): Promise<string | Output> {
  // Raw mode holds from here, and the first frame resolves once this question's turn has come.
  const reader = openReader(context);
  const draw = asking(context, settings.message, reader);
  let typed = '';
  let issue: string | undefined = undefined;
  let answered: { value: string | undefined } | undefined = undefined;
  const frame = () =>
    draw.frame({
      hint: settings.kind === 'confirm' ? confirmHint(settings.hint) : settings.hint,
      issue,
      kind: settings.kind,
      message: settings.message,
      typed: settings.kind === 'secret' ? '' : typed,
    });
  try {
    await frame();
    while (true) {
      const key = await reader.read();
      if (key.kind === 'cancel' || (key.kind === 'eof' && typed === '')) {
        context.cancel();
        context.signal.throwIfAborted();
      }
      if (key.kind === 'enter') {
        const raw = typed === '' ? (settings.hint ?? '') : typed;
        const result =
          settings.validate === undefined
            ? { issues: undefined, value: raw }
            : await settings.validate['~standard'].validate(
                raw,
                questionValidationOptions(context, settings),
              );
        context.signal.throwIfAborted();
        if (result.issues === undefined) {
          answered = {
            value: displayAnswer(settings.kind, raw, result.value),
          };
          return result.value;
        }
        issue = result.issues[0]?.message ?? 'The answer is invalid.';
        await frame();
      } else if (key.kind === 'text' || key.kind === 'backspace') {
        typed = key.kind === 'text' ? typed + key.value : backspace(typed);
        if (settings.kind !== 'secret') {
          await frame();
        }
      }
    }
  } finally {
    reader.close();
    await draw.finish(answered);
  }
}

/** A bounded viewport follows the selected entry; arrows stop at either end. */
async function askSelect<Options, Choice extends string>(
  context: PromptContext<Options>,
  settings: { message: string; choices: readonly [Choice, ...Choice[]]; prefill: unknown },
): Promise<Choice> {
  const entries = [...settings.choices.entries()];
  let selected = entries.find(([, value]) => value === settings.prefill) ?? [
    0,
    settings.choices[0],
  ];
  // Raw mode holds from here, and the first frame resolves once this question's turn has come.
  const reader = openReader(context);
  const draw = asking(context, settings.message, reader);
  let answered: { value: string } | undefined = undefined;
  let start = Math.max(0, selected[0] - MAX_VISIBLE + 1);
  const frame = () => {
    // The window reads the rows when it draws, so a resize reaches the next frame.
    const { rows } = context.host.terminal.stderr;
    const count = Math.min(
      MAX_VISIBLE,
      rows && rows > 0 ? Math.max(1, rows - FRAME_CHROME) : MAX_VISIBLE,
    );
    start = Math.max(0, Math.min(start, selected[0], settings.choices.length - count));
    if (selected[0] >= start + count) {
      start = selected[0] - count + 1;
    }
    const choices = settings.choices.slice(start, start + count);
    return draw.frame({
      above: start,
      below: settings.choices.length - start - choices.length,
      choices,
      highlighted: selected[0] - start,
      issue: undefined,
      kind: 'select',
      message: settings.message,
      rows,
    });
  };
  try {
    await frame();
    while (true) {
      const key = await reader.read();
      if (key.kind === 'cancel' || key.kind === 'eof') {
        context.cancel();
        context.signal.throwIfAborted();
      }
      if (key.kind === 'enter') {
        answered = { value: selected[1] };
        return selected[1];
      }
      if (key.kind === 'up' || key.kind === 'down') {
        const next = entries[selected[0] + (key.kind === 'up' ? -1 : 1)];
        if (next !== undefined) {
          selected = next;
          await frame();
        }
      }
    }
  } finally {
    reader.close();
    await draw.finish(answered);
  }
}

export { askSelect, askText };
