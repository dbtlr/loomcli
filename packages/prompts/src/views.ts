import type { ViewContext } from '@loomcli/core';
import { escapeControlCharacters, glyph, style as textStyle, view } from '@loomcli/core';

import { graphemes } from './line.js';

/** Operator values stay literal even though drawing preserves the library's terminal controls. */
function literal(text: string): string {
  return textStyle.escape(escapeControlCharacters(text));
}

interface TypedFrame {
  readonly kind: 'text' | 'secret' | 'confirm';
  readonly message: string;
  readonly issue: string | undefined;
  readonly typed: string;
  readonly cursor?: number | undefined; // Absent, the end of typed
  readonly hint: string | undefined;
}
interface ChoiceRow {
  readonly kind: 'choice';
  readonly label: string;
  readonly description: string | undefined;
  readonly disabled: boolean; // The choice's own disabled state; false for a choice max keeps out
  readonly reason: string | undefined; // A disabled choice's reason, when it has one
  readonly selected: boolean; // In a multiselect's selection; false at a select
}
interface SeparatorRow {
  readonly kind: 'separator';
  readonly label: string;
}
interface ListFrame {
  readonly message: string;
  readonly issue: string | undefined;
  readonly choices: readonly (ChoiceRow | SeparatorRow)[]; // The visible rows
  readonly highlighted: number | undefined; // An index into choices; undefined when no row is highlighted
  readonly above: number; // Rows hidden above the window
  readonly below: number; // Rows hidden below the window
  readonly rows: number | undefined; // Stderr's rows
  readonly term?: string | undefined; // The search term; absent when the question does not search
  readonly cursor?: number | undefined; // The term's cursor; absent, the end of term
  readonly loading?: boolean | undefined; // A source call has not settled; absent, false
}
type QuestionFrame =
  | TypedFrame
  | (ListFrame & { readonly kind: 'select' })
  | (ListFrame & {
      readonly kind: 'multiselect';
      readonly count: number; // Choices in the selection, shown or not
      readonly min: number;
      readonly max: number | undefined;
    });
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

type ListData = Exclude<QuestionFrame, TypedFrame>;
function listHelp(data: ListData, short = false): string {
  if (data.loading) {
    return `Searching${glyph.ellipsis}`;
  }
  if (data.kind === 'select') {
    if (short) {
      return '↑↓ Enter';
    }
    return data.term === undefined
      ? '↑↓ move · Enter select'
      : '↑↓ move · type to search · Enter select';
  }
  const key = data.term === undefined ? 'Space' : 'Tab';
  const count = data.max === undefined ? `${data.count}` : `${data.count}/${data.max}`;
  return `${short ? `↑↓ ${key} Enter` : `↑↓ move · ${key} toggle · Enter submit`} · ${count} selected`;
}
function listRow(
  data: ListData,
  entry: { row: ChoiceRow | SeparatorRow; highlighted: boolean },
  context: ViewContext,
): string {
  const { style } = context;
  const { row, highlighted } = entry;
  if (row.kind === 'separator') {
    return row.label === '' ? '' : style.dim(`  ${literal(row.label)}`);
  }
  const pointer = highlighted ? `${glyph.pointer} ` : '  ';
  const mark =
    data.kind === 'select'
      ? ''
      : `${row.selected ? style.highlight(glyph.circleFilled) : style.dim(glyph.circle)} `;
  const label =
    literal(row.label) + (row.disabled ? ` (${literal(row.reason ?? 'disabled')})` : '');
  if (row.disabled) {
    return style.dim(pointer + mark + label);
  }
  if (
    data.kind === 'multiselect' &&
    data.max !== undefined &&
    data.count >= data.max &&
    !row.selected
  ) {
    return (highlighted ? style.highlight(pointer) : pointer) + style.dim(mark + label);
  }
  return highlighted ? style.highlight(pointer + mark + label) : pointer + mark + label;
}
/** Restores row styles after clipping has measured its plain escaped text. */
function compactChoice(data: ListData, selected: string, context: ViewContext): string {
  const { style } = context;
  const drawn = clipped(selected, Math.max(1, context.columns ?? 80), context);
  const active = data.highlighted === undefined ? undefined : data.choices[data.highlighted];
  if (active?.kind !== 'choice') {
    return style.dim(drawn);
  }
  if (data.kind === 'multiselect' && !active.selected) {
    if (data.max !== undefined && data.count >= data.max) {
      const pointer = context.plain(glyph.pointer);
      return drawn.startsWith(pointer)
        ? style.highlight(pointer) + style.dim(drawn.slice(pointer.length))
        : style.highlight(drawn);
    }
    return style.highlight(drawn.replace(context.plain(glyph.circle), style.dim(glyph.circle)));
  }
  return style.highlight(drawn);
}

/** Fits list rows first, then compacts the surviving frame without losing an issue. */
function selectText(data: ListData, context: ViewContext, title: string): string {
  const { style, width } = context;
  const columns = Math.max(1, context.columns ?? 80);
  const rows = Math.max(1, data.rows ?? Infinity);
  const searching = data.term !== undefined;
  const firstLine = searching
    ? typedFrame(
        {
          cursor: data.cursor,
          hint: undefined,
          issue: undefined,
          kind: 'text',
          message: data.message,
          typed: data.term ?? '',
        },
        context,
      )
    : title;
  const issue =
    data.issue === undefined ? undefined : style.error(`  ${glyph.cross} ${literal(data.issue)}`);
  let start = 0;
  let end = data.choices.length;
  const active = data.highlighted === undefined ? undefined : data.choices[data.highlighted];
  const render = () => {
    const description = active?.kind === 'choice' ? active.description : undefined;
    return [
      firstLine,
      ...(data.above + start ? [style.dim(`↑ ${data.above + start} more`)] : []),
      ...data.choices
        .slice(start, end)
        .map((row, index) =>
          listRow(data, { highlighted: index + start === data.highlighted, row }, context),
        ),
      ...(data.choices.length === 0 && !data.loading ? [style.dim('  No matches')] : []),
      ...(data.below + data.choices.length - end
        ? [style.dim(`↓ ${data.below + data.choices.length - end} more`)]
        : []),
      ...(description !== undefined && columns > 2
        ? [style.dim(`  ${clipped(literal(description), columns - 2, context)}`)]
        : []),
      style.dim(listHelp(data)),
      ...(issue === undefined ? [] : [issue]),
    ].join('\n');
  };
  const height = (text: string) =>
    text
      .split('\n')
      .reduce(
        (total, line) =>
          total +
          Math.max(
            1,
            Math.ceil(
              width(line) / (context.columns === undefined ? Infinity : Math.max(1, columns - 1)),
            ),
          ),
        0,
      );
  let frame = render();
  while (end - start > 1 && height(frame) > rows) {
    if (data.highlighted !== undefined && data.highlighted - start > end - 1 - data.highlighted) {
      start += 1;
    } else {
      end -= 1;
    }
    frame = render();
  }
  if (height(frame) <= rows) {
    return frame;
  }
  const compactTitle = searching
    ? firstLine
    : `${style.info.bold('?')}${columns > 2 ? ` ${style.bold(clipped(data.message, columns - 2, context))}` : ''}`;
  let selected: string | undefined = undefined;
  if (active !== undefined) {
    selected = listRow(data, { highlighted: true, row: active }, context);
  } else if (data.choices.length > 0) {
    selected = 'No choice can be selected';
  } else if (!data.loading) {
    selected = 'No matches';
  }
  const choice = selected === undefined ? undefined : compactChoice(data, selected, context);
  const above = data.above + (data.highlighted ?? 0);
  const below =
    data.below +
    data.choices.length -
    (data.highlighted === undefined ? data.choices.length : data.highlighted + 1);
  const markers = [...(above ? [`↑ ${above} more`] : []), ...(below ? [`↓ ${below} more`] : [])];
  let help = listHelp(data, width(listHelp(data)) > columns);
  while (
    markers.length &&
    2 + (choice === undefined ? 0 : 1) + markers.length + (issue === undefined ? 0 : 1) > rows
  ) {
    help += ` · ${markers.pop() ?? ''}`;
  }
  const footer = issue ?? style.dim(help);
  if (rows <= 2) {
    if (searching) {
      if (rows === 1) {
        return issue === undefined ? compactTitle : style.error(clipped(issue, columns, context));
      }
      return `${compactTitle}\n${clipped(issue ?? `${choice ?? ''} · ${footer}`, columns, context)}`;
    }
    const heading = clipped(`${choice ?? ''} · ${compactTitle}`, columns, context);
    return rows === 1
      ? clipped(`${heading} · ${footer}`, columns, context)
      : `${heading}\n${clipped(footer, columns, context)}`;
  }
  return [
    compactTitle,
    ...(choice === undefined ? [] : [choice]),
    ...markers.map((marker) => style.dim(clipped(marker, columns, context))),
    ...(rows === 3 && issue !== undefined ? [] : [style.dim(clipped(help, columns, context))]),
    ...(issue === undefined ? [] : [style.error(clipped(issue, columns, context))]),
  ].join('\n');
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
function typedFrame(data: TypedFrame, context: ViewContext): string {
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
    if (data.kind === 'select' || data.kind === 'multiselect') {
      return selectText(data, context, title);
    }
    return typedFrame(data, context) + issue;
  },
});
const answeredLine = view<AnsweredLine>('@loomcli/prompts/answered-line', {
  render: ({ message, answer }, { style }) =>
    `${style.dim('?')} ${message}${answer === undefined ? '' : ` ${style.dim('·')} ${answer === '' ? style.dim('none') : style.highlight(literal(answer))}`}\n`,
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
export type {
  AnsweredLine,
  CancelledLine,
  ProgressLine,
  QuestionFrame,
  TypedFrame,
  ListFrame,
  ChoiceRow,
  SeparatorRow,
};
