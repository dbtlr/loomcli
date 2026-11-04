import type { ViewContext } from '@loomcli/core';
import { escapeControlCharacters, glyph, style as textStyle, view } from '@loomcli/core';

import { graphemes } from './line.js';

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
    | {
        kind: 'text' | 'secret' | 'confirm';
        typed: string;
        /** The cursor's grapheme index into `typed`; absent, the cursor is at the end of `typed`. */
        cursor?: number | undefined;
        hint: string | undefined;
      }
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

/** Fits one editable field with a stateless window around its cursor cell. */
function field(
  data: { text: string; cursor: number; hint: boolean; columns: number },
  context: ViewContext,
): string {
  const { text, cursor, hint, columns } = data;
  const { style, width } = context;
  const ellipsis = style.dim(glyph.ellipsis);
  const cells = graphemes(text).map((part) => {
    const drawn = literal(part);
    return { drawn: width(drawn) === 0 ? `${drawn} ` : drawn, width: Math.max(1, width(drawn)) };
  });
  if ((!hint && cursor === cells.length) || cells.length === 0) {
    cells.push({ drawn: ' ', width: 1 });
  }
  let position = 0;
  const placed = cells.map((cell, index) => {
    const start = position;
    position += cell.width;
    return { cursor: index === cursor, drawn: cell.drawn, start, width: cell.width };
  });
  const active = placed.find((cell) => cell.cursor) ?? { drawn: ' ', start: 0, width: 1 };
  const paint = (drawn: string, selected: boolean) => {
    const value = hint ? style.dim(drawn) : drawn;
    return selected ? style.inverse(value) : value;
  };
  if (hint && position > columns) {
    let result = '';
    let used = 0;
    for (const cell of placed) {
      if (used + cell.width > columns - 1) {
        break;
      }
      result += paint(cell.drawn, cell.cursor);
      used += cell.width;
    }
    return used === 0 ? style.inverse(' ') : result + ' '.repeat(columns - 1 - used) + ellipsis;
  }
  if (position <= columns) {
    return placed.map((cell) => paint(cell.drawn, cell.cursor)).join('');
  }
  if (columns < active.width + 2) {
    return style.inverse(active.width > columns ? glyph.ellipsis : active.drawn);
  }
  const start = active.start - Math.floor((columns - active.width) / 2);
  const head = start <= 0;
  const tail = !head && start + columns >= position;
  let from = start + 1;
  if (head) {
    from = 0;
  } else if (tail) {
    from = position - (columns - 1);
  }
  let to = start + columns - 1;
  if (head) {
    to = columns - 1;
  } else if (tail) {
    to = position;
  }
  let result = head ? '' : ellipsis;
  let offset = from;
  for (const cell of placed) {
    if (cell.start < from || cell.start + cell.width > to) {
      continue;
    }
    result += ' '.repeat(cell.start - offset) + paint(cell.drawn, cell.cursor);
    offset = cell.start + cell.width;
  }
  result += ' '.repeat(to - offset);
  return result + (tail ? '' : ellipsis);
}

/** Gives message and separator space to the input field as the destination narrows. */
function typedFrame(
  data: Exclude<QuestionFrame, { kind: 'select' }>,
  context: ViewContext,
): string {
  const { style, width } = context;
  const columns = Math.max(1, context.columns ?? 80);
  // Only the glyph or the legend is dim, and the spaces around it are plain.
  const label = data.kind === 'confirm' ? (data.hint ?? '[y/n]') : '›';
  const separator = ` ${style.dim(label)} `;
  const separatorWidth = width(label) + 2;
  let prefix = '';
  if (columns >= 2 + 1 + separatorWidth + 16) {
    const messageColumns = columns - 2 - separatorWidth - 16;
    const message =
      width(data.message) <= messageColumns
        ? data.message
        : clipped(data.message, messageColumns, context);
    prefix = `${style.info.bold('?')} ${style.bold(message)}${separator}`;
  } else if (columns >= 1 + separatorWidth + 4) {
    prefix = style.info.bold('?') + separator;
  } else if (columns >= 3) {
    prefix = `${style.info.bold('?')} `;
  } else {
    prefix = columns === 2 ? style.info.bold('?') : '';
  }
  const budget = columns - width(prefix);
  if (data.kind === 'secret') {
    return prefix + style.inverse(' ');
  }
  const hint =
    data.kind === 'text' && data.typed === '' && data.hint !== undefined && data.hint !== '';
  return (
    prefix +
    field(
      {
        columns: budget,
        cursor: hint ? 0 : (data.cursor ?? graphemes(data.typed).length),
        hint,
        text: hint ? (data.hint ?? '') : data.typed,
      },
      context,
    )
  );
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
    return typedFrame(data, context) + issue;
  },
});
const answeredLine = view<AnsweredLine>('@loomcli/prompts/answered-line', {
  render: ({ message, answer }, { style }) =>
    `${style.dim('?')} ${message}${answer === undefined ? '' : ` ${style.dim('·')} ${style.highlight(literal(answer))}`}\n`,
});
const cancelledLine = view<CancelledLine>('@loomcli/prompts/cancelled-line', {
  render: ({ message }, { style }) => `${style.dim(`? ${message} · cancelled`)}\n`,
});

/** What one progress line's view draws: its state, its counts, its spinner frame, and its time. */
interface ProgressLine {
  readonly state: 'running' | 'ended' | 'failed' | 'cancelled';
  /** The label while the line runs, and the end message once it has ended or failed. */
  readonly label: string;
  readonly completed: number | undefined;
  readonly total: number | undefined;
  /** The spinner's current frame. */
  readonly frame: string;
  readonly bar: { readonly complete: string; readonly incomplete: string };
  /** Milliseconds since `progress()` opened the line. */
  readonly elapsed: number;
}

/** The cells of a progress bar, which the default view never widens. */
const BAR_CELLS = 10;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;

/** The complete cells of a bar: its share of 10, rounded down and held between 0 and 10. */
function completeCells(completed: number, total: number): number {
  if (total === 0) {
    return BAR_CELLS;
  }
  return Math.min(BAR_CELLS, Math.max(0, Math.floor((BAR_CELLS * completed) / total)));
}

/** `completed/total` for whole numbers, and otherwise the percent, rounded down. */
function counts(completed: number, total: number): string {
  if (Number.isInteger(completed) && Number.isInteger(total)) {
    return `${String(completed)}/${String(total)}`;
  }
  return total === 0 ? '100%' : `${String(Math.floor((100 * completed) / total))}%`;
}

/** Elapsed time, rounded down: `2.4s` under a minute, `1m 05s` under an hour, and `1h 02m` from one. */
function elapsedTime(elapsed: number): string {
  const whole = Math.max(0, Math.floor(elapsed));
  if (whole < MINUTE) {
    return `${(Math.floor(whole / 100) / 10).toFixed(1)}s`;
  }
  if (whole < HOUR) {
    const seconds = Math.floor((whole % MINUTE) / SECOND);
    return `${String(Math.floor(whole / MINUTE))}m ${String(seconds).padStart(2, '0')}s`;
  }
  const minutes = Math.floor((whole % HOUR) / MINUTE);
  return `${String(Math.floor(whole / HOUR))}h ${String(minutes).padStart(2, '0')}m`;
}

const progressLine = view<ProgressLine>('@loomcli/prompts/progress', {
  render: (data, { style }) => {
    const time = `${style.dim('·')} ${style.dim(elapsedTime(data.elapsed))}`;
    if (data.state === 'cancelled') {
      return style.dim(`${glyph.squareCenter} ${data.label} (cancelled)`);
    }
    if (data.state === 'ended') {
      return `${style.success(glyph.success)} ${data.label} ${time}`;
    }
    if (data.state === 'failed') {
      return `${style.error(glyph.error)} ${data.label} ${time}`;
    }
    const completed = data.completed ?? 0;
    let measure = '';
    if (data.total !== undefined) {
      const complete = completeCells(completed, data.total);
      const bar =
        style.highlight(textStyle.escape(data.bar.complete.repeat(complete))) +
        style.dim(textStyle.escape(data.bar.incomplete.repeat(BAR_CELLS - complete)));
      measure = ` ${bar} ${counts(completed, data.total)}`;
    } else if (data.completed !== undefined) {
      measure = ` ${String(data.completed)}`;
    }
    return `${style.highlight(textStyle.escape(data.frame))} ${data.label}${measure} ${time}`;
  },
});

export { answeredLine, cancelledLine, progressLine, questionFrame };
export type { AnsweredLine, CancelledLine, ProgressLine, QuestionFrame };
