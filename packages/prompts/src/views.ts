import type { ViewContext } from '@loomcli/core';
import { escapeControlCharacters, glyph, style as textStyle, view } from '@loomcli/core';

/** Operator values stay literal even though drawing preserves the library's terminal controls. */
function literal(text: string): string {
  return textStyle.escape(escapeControlCharacters(text));
}

interface BaseFrame {
  message: string;
  issue: string | undefined;
}
type QuestionFrame = BaseFrame &
  (
    | { kind: 'text' | 'secret' | 'confirm'; typed: string; hint: string | undefined }
    | {
        kind: 'select';
        choices: readonly string[];
        highlighted: number;
        above: number;
        below: number;
        rows: number | undefined;
      }
  );
interface AnsweredLine {
  message: string;
  answer: string | undefined;
}
interface CancelledLine {
  message: string;
}

/** Clipping uses plain grapheme boundaries, then escapes the result back into marked output. */
function clipped(text: string, columns: number, context: ViewContext): string {
  const plain = context.plain(text);
  if (context.width(literal(plain)) <= columns) {
    return literal(plain);
  }
  const ellipsis = context.plain(glyph.ellipsis);
  const budget = Math.max(0, columns - context.width(literal(ellipsis)));
  const segments = Array.from(
    new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(plain),
    (segment) => segment.segment,
  );
  let prefix = '';
  let suffix = '';
  for (const segment of segments) {
    if (context.width(literal(prefix + segment)) > Math.floor(budget / 2)) {
      break;
    }
    prefix += segment;
  }
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment === undefined) {
      break;
    }
    if (context.width(literal(segment + suffix)) > budget - context.width(literal(prefix))) {
      break;
    }
    suffix = segment + suffix;
  }
  return literal(prefix + ellipsis + suffix);
}

/** Minimal frames keep the selected value and key help readable when ordinary rows cannot fit. */
function compactSelect(
  data: Extract<QuestionFrame, { kind: 'select' }>,
  context: ViewContext,
): string {
  const { style } = context;
  const columns = context.columns ?? 80;
  const rows = Math.max(1, data.rows ?? 24);
  const selected = data.choices[data.highlighted] ?? '';
  const above = data.above + data.highlighted;
  const below = data.below + data.choices.length - data.highlighted - 1;
  let title =
    columns > 2
      ? `${style.info.bold('?')} ${style.bold(clipped(data.message, columns - 2, context))}`
      : style.info.bold('?');
  const choice = style.highlight(
    clipped(`${glyph.pointer} ${literal(selected)}`, columns, context),
  );
  const markers = [...(above ? [`↑ ${above} more`] : []), ...(below ? [`↓ ${below} more`] : [])];
  const help =
    columns < context.width('↑↓ move · Enter select') ? '↑↓ Enter' : '↑↓ move · Enter select';
  let footer = help;
  while (markers.length > 0 && markers.length + 3 > rows) {
    footer += ` · ${markers.pop() ?? ''}`;
  }
  const hints = markers.map((marker) => style.dim(clipped(marker, columns, context)));
  footer = style.dim(clipped(footer, columns, context));
  if (rows < 3) {
    title = style.highlight(clipped(`${choice} · ${title}`, columns, context));
    return rows === 1 ? clipped(`${title} · ${footer}`, columns, context) : `${title}\n${footer}`;
  }
  return [title, choice, ...hints, footer].join('\n');
}

/** A select shrinks its visible window before any frame can scroll its own redraw region. */
function selectText(
  data: Extract<QuestionFrame, { kind: 'select' }>,
  context: ViewContext,
  title: string,
): string {
  const { style, width } = context;
  let start = 0;
  let end = data.choices.length;
  const render = () => {
    const choices = data.choices
      .slice(start, end)
      .map((choice, index) =>
        index + start === data.highlighted
          ? style.highlight(`${glyph.pointer} ${literal(choice)}`)
          : `  ${literal(choice)}`,
      );
    const above = data.above + start;
    const below = data.below + data.choices.length - end;
    return [
      title,
      ...(above ? [style.dim(`↑ ${above} more`)] : []),
      ...choices,
      ...(below ? [style.dim(`↓ ${below} more`)] : []),
      style.dim('↑↓ move · Enter select'),
    ].join('\n');
  };
  const height = (text: string) =>
    text.split('\n').reduce((total, line) => {
      // A wide grapheme can leave one cell unused at a wrap, so the estimate stays conservative.
      const cells = context.columns === undefined ? Infinity : Math.max(1, context.columns - 1);
      return total + Math.max(1, Math.ceil(width(line) / cells));
    }, 0);
  let frame = render();
  while (end - start > 1 && data.rows !== undefined && data.rows > 0 && height(frame) > data.rows) {
    if (data.highlighted - start > end - 1 - data.highlighted) {
      start += 1;
    } else {
      end -= 1;
    }
    frame = render();
  }
  if (data.rows !== undefined && data.rows > 0 && height(frame) > data.rows) {
    return compactSelect(data, context);
  }
  return frame;
}

const questionFrame = view<QuestionFrame>('@loomcli/prompts/question-frame', {
  render: (data, context) => {
    const { style } = context;
    const title = `${style.info.bold('?')} ${style.bold(data.message)}`;
    const issue =
      data.issue === undefined ? '' : `\n  ${style.error(`${glyph.cross} ${literal(data.issue)}`)}`;
    if (data.kind === 'select') {
      return selectText(data, context, title) + issue;
    }
    const cursor = style.inverse(' ');
    let content = '';
    if (data.kind !== 'secret') {
      content = data.typed === '' ? style.dim(literal(data.hint ?? '')) : literal(data.typed);
    }
    const line =
      data.kind === 'confirm'
        ? `${title} ${style.dim(data.hint ?? '[y/n]')} ${literal(data.typed)}${cursor}`
        : `${title} ${style.dim('›')} ${content}${cursor}`;
    return `${line}${issue}`;
  },
});
const answeredLine = view<AnsweredLine>('@loomcli/prompts/answered-line', {
  render: ({ message, answer }, { style }) =>
    `${style.dim('?')} ${message}${answer === undefined ? '' : ` ${style.dim('·')} ${style.highlight(literal(answer))}`}\n`,
});
const cancelledLine = view<CancelledLine>('@loomcli/prompts/cancelled-line', {
  render: ({ message }, { style }) => `${style.dim(`? ${message} · cancelled`)}\n`,
});

export { answeredLine, cancelledLine, questionFrame };
export type { AnsweredLine, CancelledLine, QuestionFrame };
