import type { ViewContext } from '@loomcli/core';
import { escapeControlCharacters, glyph, style as textStyle, view } from '@loomcli/core';

import { graphemes, leading } from './line.js';
import { logRow } from './log.js';

/** Operator values stay literal even though drawing preserves the library's terminal controls. */
function literal(text: string): string {
  return textStyle.escape(escapeControlCharacters(text));
}

/**
 * The data of a text, secret, or confirm question's frame: the typed line, its cursor, and the hint.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#frames-and-views
 * @public
 */
interface TypedFrame {
  /** Which typed question the frame draws. */
  readonly kind: 'text' | 'secret' | 'confirm';
  /** The question's message. */
  readonly message: string;
  /** The reason the last answer was refused, or `undefined` when there is none. */
  readonly issue: string | undefined;
  /** What the operator has typed, which is always empty for a secret. */
  readonly typed: string;
  /** A grapheme index into `typed`; absent, the end of `typed`. */
  readonly cursor?: number | undefined;
  /** The question's hint for text, the legend for confirm, or `undefined` when there is none. */
  readonly hint: string | undefined;
}
/**
 * One choice in a list frame's visible window.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#list-frames
 * @public
 */
interface ChoiceRow {
  /** Marks the row as a choice. */
  readonly kind: 'choice';
  /** The text the row shows. */
  readonly label: string;
  /** The choice's description, shown below the list while it is highlighted. */
  readonly description: string | undefined;
  /** The choice's own disabled state, which is false for a choice `max` keeps out. */
  readonly disabled: boolean;
  /** A disabled choice's reason, when it has one. */
  readonly reason: string | undefined;
  /** Whether the choice is in a multiselect's selection, which is false at a select. */
  readonly selected: boolean;
}
/**
 * One separator in a list frame's visible window.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#list-frames
 * @public
 */
interface SeparatorRow {
  /** Marks the row as a separator. */
  readonly kind: 'separator';
  /** The text the row shows, or the empty string for a blank row. */
  readonly label: string;
}
/**
 * The data of a select or multiselect question's frame: the visible rows, the highlight, and what
 * the window hides.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#list-frames
 * @public
 */
interface ListFrame {
  /** The question's message. */
  readonly message: string;
  /** The message drawn below the list, such as why the last answer was refused, or `undefined` when none. */
  readonly issue: string | undefined;
  /** The visible rows. */
  readonly choices: readonly (ChoiceRow | SeparatorRow)[];
  /** An index into `choices`, or `undefined` when no row is highlighted. */
  readonly highlighted: number | undefined;
  /** The count of rows hidden above the window. */
  readonly above: number;
  /** The count of rows hidden below the window. */
  readonly below: number;
  /** The rows of stderr, or `undefined` when it has none. */
  readonly rows: number | undefined;
  /** The search term; absent when the question does not search. */
  readonly term?: string | undefined;
  /** The term's cursor; absent, the end of `term`. */
  readonly cursor?: number | undefined;
  /** Whether a source call has not settled; absent, false. */
  readonly loading?: boolean | undefined;
}
/**
 * The data of an editor question's frame: whether the operator's editor is open.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#frames-and-views
 * @public
 */
interface EditorFrame {
  /** Marks the frame as an editor question's. */
  readonly kind: 'editor';
  /** The question's message. */
  readonly message: string;
  /** The reason the last answer was refused, or `undefined` when there is none. */
  readonly issue: string | undefined;
  /** Whether the editor is open and the question waits for it to close. */
  readonly editing: boolean;
}
/**
 * The data of any question's active frame, told apart by `kind`.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#frames-and-views
 * @public
 */
type QuestionFrame =
  | EditorFrame
  | TypedFrame
  | (ListFrame & { readonly kind: 'select' })
  | (ListFrame & {
      readonly kind: 'multiselect';
      /** The count of choices in the selection, shown or not. */
      readonly count: number;
      /** The fewest choices the operator must pick. */
      readonly min: number;
      /** The most choices the operator may pick, or `undefined` when there is no limit. */
      readonly max: number | undefined;
    });
/**
 * The data of the line that stays once a question is answered.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#frames-and-views
 * @public
 */
interface AnsweredLine {
  /** An editor answer's line count, which an editor question always supplies. */
  readonly lines?: number;
  /** The question's message. */
  message: string;
  /** The answer as a display string, or `undefined` for a secret. */
  answer: string | undefined;
  /** The question's kind; absent, a typed answer. */
  readonly kind?: QuestionFrame['kind'] | undefined;
}
/**
 * The data of the line that stays once a question is cancelled.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#leaving-a-question
 * @public
 */
interface CancelledLine {
  /** The question's message. */
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

type ListData = Exclude<QuestionFrame, TypedFrame | EditorFrame>;
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
function compactChoice(
  data: ListData,
  { selected, columns }: { readonly selected: string; readonly columns: number },
  context: ViewContext,
): string {
  const { style } = context;
  const drawn = clipped(selected, columns, context);
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

/**
 * The compact frame's key help with the markers that joined it. It abbreviates when `columns` is
 * narrower than the whole key help, the markers included, and a multiselect keeps its count.
 */
function keyHelp(
  data: ListData,
  { joined, columns }: { readonly joined: readonly string[]; readonly columns: number },
  context: ViewContext,
): string {
  const whole = [listHelp(data), ...joined].join(' · ');
  return context.width(whole) <= columns ? whole : [listHelp(data, true), ...joined].join(' · ');
}

/**
 * One part of a shared row: its whole width, its width once abbreviated, how it draws in a budget,
 * and when it drops.
 */
interface RowPart {
  readonly width: number;
  readonly short?: number;
  readonly draw: (columns: number) => string;
  /** Parts drop highest first while the separators leave fewer columns than parts; 0 never drops. */
  readonly drop: number;
}

/**
 * The columns each part gets from `budget`: a part narrower than an even share keeps its width
 * and leaves the rest to the others, and the wider parts split what is left evenly, the earlier
 * ones taking the remainder.
 */
function shares(widths: readonly number[], budget: number): number[] {
  const result = widths.map(() => 0);
  let open = widths.map((_width, index) => index);
  let remaining = budget;
  while (open.length > 0) {
    const even = Math.floor(remaining / open.length);
    const narrow = open.filter((index) => (widths[index] ?? 0) <= even);
    if (narrow.length === 0) {
      let extra = remaining - even * open.length;
      for (const index of open) {
        result[index] = even + (extra > 0 ? 1 : 0);
        extra -= 1;
      }
      break;
    }
    for (const index of narrow) {
      result[index] = widths[index] ?? 0;
      remaining -= widths[index] ?? 0;
    }
    open = open.filter((index) => !narrow.includes(index));
  }
  return result;
}

/** Parts that share one row, joined by ` · `, each whole when they fit and each clipped when not. */
function shared(
  parts: readonly (RowPart | undefined)[],
  columns: number,
  context: ViewContext,
): string {
  let present = parts.filter((part) => part !== undefined);
  while (present.length > 1 && columns - 3 * (present.length - 1) < present.length) {
    const highest = Math.max(...present.map((part) => part.drop));
    present = present.filter((part) => part.drop !== highest);
  }
  const budget = columns - 3 * (present.length - 1);
  const whole = present.reduce((total, part) => total + part.width, 0) <= budget;
  const given = shares(
    present.map((part) => (whole ? part.width : (part.short ?? part.width))),
    budget,
  );
  return present
    .map((part, index) => part.draw(Math.max(1, given[index] ?? 0)))
    .join(` ${context.style.dim('·')} `);
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
  const titleAt = (budget: number) =>
    `${style.info.bold('?')}${budget > 2 ? ` ${style.bold(clipped(data.message, budget - 2, context))}` : ''}`;
  const compactTitle = searching ? firstLine : titleAt(columns);
  let selected: string | undefined = undefined;
  if (active !== undefined) {
    selected = listRow(data, { highlighted: true, row: active }, context);
  } else if (data.choices.length > 0) {
    selected = 'No choice can be selected';
  } else if (!data.loading) {
    selected = 'No matches';
  }
  const above = data.above + (data.highlighted ?? 0);
  const below =
    data.below +
    data.choices.length -
    (data.highlighted === undefined ? data.choices.length : data.highlighted + 1);
  const markers = [...(above ? [`↑ ${above} more`] : []), ...(below ? [`↓ ${below} more`] : [])];
  // The markers that would not fit on lines of their own join the key help, in their own order.
  const joined: string[] = [];
  while (
    markers.length &&
    2 + (selected === undefined ? 0 : 1) + markers.length + (issue === undefined ? 0 : 1) > rows
  ) {
    joined.unshift(markers.pop() ?? '');
  }
  const help = (budget: number) => keyHelp(data, { columns: budget, joined }, context);
  const choicePart =
    selected === undefined
      ? undefined
      : {
          draw: (budget: number) => compactChoice(data, { columns: budget, selected }, context),
          drop: 1,
          width: width(literal(context.plain(selected))),
        };
  const issueText = `${glyph.cross} ${literal(data.issue ?? '')}`;
  const footerPart =
    data.issue === undefined
      ? {
          draw: (budget: number) => style.dim(clipped(help(budget), budget, context)),
          drop: 0,
          short: width(help(0)),
          width: width(help(Infinity)),
        }
      : {
          draw: (budget: number) => style.error(clipped(issueText, budget, context)),
          drop: 0,
          width: width(issueText),
        };
  if (rows <= 2) {
    if (searching) {
      if (rows === 1) {
        return issue === undefined ? compactTitle : style.error(clipped(issue, columns, context));
      }
      return `${compactTitle}\n${shared([choicePart, footerPart], columns, context)}`;
    }
    const titlePart = {
      draw: titleAt,
      drop: 2,
      width: 2 + width(literal(context.plain(data.message))),
    };
    return rows === 1
      ? shared([choicePart, titlePart, footerPart], columns, context)
      : `${shared([choicePart, titlePart], columns, context)}\n${
          issue === undefined
            ? footerPart.draw(columns)
            : style.error(clipped(issue, columns, context))
        }`;
  }
  return [
    compactTitle,
    ...(choicePart === undefined ? [] : [choicePart.draw(columns)]),
    ...markers.map((marker) => style.dim(clipped(marker, columns, context))),
    ...(rows === 3 && issue !== undefined
      ? []
      : [style.dim(clipped(help(columns), columns, context))]),
    ...(issue === undefined ? [] : [style.error(clipped(issue, columns, context))]),
  ].join('\n');
}

/** Fits one editable field with a stateless window around its cursor cell. */
function field(
  data: {
    text: string;
    cursor: number;
    hint: boolean;
    columns: number;
    editor?: boolean | undefined;
  },
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
    return selected && !data.editor ? style.inverse(value) : value;
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
    if (used === 0) {
      return data.editor ? '' : style.inverse(' ');
    }
    return result + ' '.repeat(columns - 1 - used) + ellipsis;
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
  data: TypedFrame & { editor?: boolean | undefined },
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
        editor: data.editor,
        hint,
        text: hint ? (data.hint ?? '') : data.typed,
      },
      context,
    )
  );
}

/**
 * The declared view that draws a question's active frame, for a `QuestionFrame` of any kind. An
 * application restyles it with `override`.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { questionFrame } from '@loomcli/prompts/views';
 *
 * export const preview = new Command('preview').action(async (context) => {
 *   await context.out.draw(
 *     { kind: 'text', message: 'Service port', issue: undefined, typed: '80', hint: undefined },
 *     questionFrame,
 *   );
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#frames-and-views
 * @public
 */
const questionFrame = view<QuestionFrame>('@loomcli/prompts/question-frame', {
  render: (data, context) => {
    const { style } = context;
    const title = `${style.info.bold('?')} ${style.bold(data.message)}`;
    const issue =
      data.issue === undefined ? '' : `\n  ${style.error(`${glyph.cross} ${literal(data.issue)}`)}`;
    if (data.kind === 'select' || data.kind === 'multiselect') {
      return selectText(data, context, title);
    }
    if (data.kind === 'editor') {
      return (
        typedFrame(
          {
            editor: true,
            hint: data.editing
              ? `Waiting for your editor to close the file${context.plain(glyph.ellipsis)}`
              : 'Press Enter to open your editor',
            issue: undefined,
            kind: 'text',
            message: data.message,
            typed: '',
          },
          context,
        ) + issue
      );
    }
    return typedFrame(data, context) + issue;
  },
});
/** Clips the answer before the message, then gives up the count as the row narrows. */
function editorAnswer(
  data: { message: string; answer: string; lines: number },
  context: ViewContext,
): string {
  const { style, width } = context;
  const columns = Math.max(1, context.columns ?? 80);
  // An answer with no visible line reads as a dim `empty`, which stays dim however it clips.
  const paint = data.answer === '' ? style.dim : style.highlight;
  let message = data.message;
  let answer = paint(data.answer === '' ? 'empty' : literal(data.answer));
  let count =
    data.answer !== '' && data.lines > 1
      ? ` ${style.dim(`(+${data.lines - 1} ${data.lines === 2 ? 'line' : 'lines'})`)}`
      : '';
  const row = () => `${style.dim('?')} ${message} ${style.dim('·')} ${answer}${count}`;
  /** The longest run of the text's leading graphemes that fits in `budget`, unescaped. */
  const clippedTo = (text: string, budget: number) =>
    leading(text, budget, (candidate) => width(literal(candidate)));
  if (width(row()) > columns) {
    const budget = Math.max(width(glyph.ellipsis), columns - width(row()) + width(answer));
    const kept = clippedTo(
      data.answer === '' ? 'empty' : data.answer,
      budget - width(glyph.ellipsis),
    );
    answer = paint(literal(kept) + glyph.ellipsis);
  }
  if (width(row()) > columns) {
    const budget = columns - width(row()) + width(message);
    message = clipped(message, Math.max(width(glyph.ellipsis), budget), context);
  }
  if (width(row()) > columns) {
    count = '';
  }
  if (width(row()) <= columns) {
    return `${row()}\n`;
  }
  // The row clips to its leading graphemes, each part keeping its own style.
  const parts: [string, (text: string) => string][] = [
    ['?', style.dim],
    [' ', (text) => text],
    [context.plain(message), literal],
    [' ', (text) => text],
    ['·', style.dim],
    [' ', (text) => text],
    [context.plain(answer), (text) => paint(literal(text))],
  ];
  let room = columns;
  let fitted = '';
  for (const [text, draw] of parts) {
    const kept = clippedTo(text, room);
    if (kept !== '') {
      fitted += draw(kept);
    }
    if (kept !== text) {
      break;
    }
    room -= width(literal(kept));
  }
  return `${fitted}\n`;
}

/**
 * The declared view that draws the line a question leaves once it is answered. An application
 * restyles it with `override`.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { answeredLine } from '@loomcli/prompts/views';
 *
 * export const preview = new Command('preview').action(async (context) => {
 *   await context.out.draw({ message: 'Service port', answer: '8080', kind: 'text' }, answeredLine);
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#frames-and-views
 * @public
 */
const answeredLine = view<AnsweredLine>('@loomcli/prompts/answered-line', {
  render: ({ message, answer, kind, lines }, context) => {
    const { style } = context;
    if (kind === 'editor') {
      return editorAnswer({ answer: answer ?? '', lines: lines ?? 0, message }, context);
    }
    if (answer === undefined) {
      return `${style.dim('?')} ${message}\n`;
    }
    // Only an empty selection reads as none: a typed empty answer is the empty string itself.
    const drawn =
      answer === '' && kind === 'multiselect'
        ? style.dim('none')
        : style.highlight(literal(answer));
    return `${style.dim('?')} ${message} ${style.dim('·')} ${drawn}\n`;
  },
});
/**
 * The declared view that draws the line a question leaves once it is cancelled. An application
 * restyles it with `override`.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { cancelledLine } from '@loomcli/prompts/views';
 *
 * export const preview = new Command('preview').action(async (context) => {
 *   await context.out.draw({ message: 'Service port' }, cancelledLine);
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#frames-and-views
 * @public
 */
const cancelledLine = view<CancelledLine>('@loomcli/prompts/cancelled-line', {
  render: ({ message }, { style }) => `${style.dim(`? ${message} · cancelled`)}\n`,
});

/**
 * One choice of the numbered list a select or multiselect prints when it asks line by line.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#asking-line-by-line
 * @public
 */
interface NumberedChoice {
  /** Marks the row as a choice. */
  readonly kind: 'choice';
  /**
   * The number the operator types to choose it, counted from 1 in the list's order, or
   * `undefined` for a disabled choice, which takes none.
   */
  readonly number: number | undefined;
  /** The text the row shows. */
  readonly label: string;
  /** The choice's description, which the row shows after its label, or `undefined` when it has none. */
  readonly description: string | undefined;
  /** A disabled choice's reason, when it has one. */
  readonly reason: string | undefined;
}

/**
 * One piece a question prints when it asks line by line, on a terminal that does not redraw in
 * place. The question prints each piece once and never draws it again: a text, secret, or confirm
 * question's asking row; a select's or multiselect's message, numbered list, and the row it asks
 * on; and the issue that refused an answer, before the question asks again.
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#asking-line-by-line
 * @public
 */
type QuestionLine =
  | {
      /** The asking row of a text, secret, or confirm question, which the operator's answer follows. */
      readonly kind: 'text' | 'secret' | 'confirm';
      /** The question's message. */
      readonly message: string;
      /**
       * What Enter alone answers, which the row shows in brackets: a text question's prefill, or a
       * confirm question's legend, `Y/n`, `y/N`, or `y/n`. `undefined` when there is none, and
       * always for a secret.
       */
      readonly hint: string | undefined;
    }
  | {
      /** A select's or multiselect's message, on a row of its own above its list. */
      readonly kind: 'title';
      /** The question's message. */
      readonly message: string;
    }
  | {
      /** A select's or multiselect's numbered list, one row for each entry. */
      readonly kind: 'list';
      /** The rows in the list's order, which is empty when a search matched nothing. */
      readonly choices: readonly (NumberedChoice | SeparatorRow)[];
    }
  | {
      /**
       * The row a select or multiselect asks on: `number` after a select's list, `numbers` after a
       * multiselect's, `search` before a search, and `refine` after a search's list.
       */
      readonly kind: 'number' | 'numbers' | 'search' | 'refine';
      /**
       * What Enter alone answers, which the row shows in brackets: the numbers at `number` and
       * `numbers`, such as `1` or `1,3`, and at `refine` the default's labels joined with `,`,
       * such as `us-east`, or `none` at a multiselect that may be left empty. `undefined` when
       * there is none, and always at `search`.
       */
      readonly hint: string | undefined;
    }
  | {
      /** The sentence that refused the last answer, on a row of its own. */
      readonly kind: 'issue';
      /** The sentence. */
      readonly issue: string;
    };

/** The fixed label of each row a select or multiselect asks on. */
const askingLabels = {
  number: 'Enter a number',
  numbers: 'Enter numbers separated by commas',
  refine: 'Enter a number, or text to search again',
  search: 'Search',
} as const;

/** One row of a numbered list, indented two columns, with its line break. */
function numberedRow(row: NumberedChoice | SeparatorRow, context: ViewContext): string {
  const { style } = context;
  if (row.kind === 'separator') {
    return row.label === '' ? '\n' : `${style.dim(`  ${literal(row.label)}`)}\n`;
  }
  if (row.number === undefined) {
    return `${style.dim(`  ${literal(row.label)} (${literal(row.reason ?? 'disabled')})`)}\n`;
  }
  const description =
    row.description === undefined || row.description === ''
      ? ''
      : `${style.dim(' · ')}${literal(row.description)}`;
  return `  ${row.number}. ${literal(row.label)}${description}\n`;
}

/** A row the operator answers on: its text, the hint in dim brackets when there is one, and `: `. */
function askingRow(text: string, hint: string | undefined, context: ViewContext): string {
  const bracketed = hint === undefined ? '' : ` ${context.style.dim(`[${literal(hint)}]`)}`;
  return `${text}${bracketed}: `;
}

/**
 * The declared view that draws each piece a question prints when it asks line by line. Its
 * default rendering moves no cursor and erases nothing, and an application restyles it with
 * `override`.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { questionLine } from '@loomcli/prompts/views';
 *
 * export const preview = new Command('preview').action(async (context) => {
 *   await context.out.draw({ hint: 'my-app', kind: 'text', message: 'Project name' }, questionLine);
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#asking-line-by-line
 * @public
 */
const questionLine = view<QuestionLine>('@loomcli/prompts/question-line', {
  render: (data, context) => {
    const { style } = context;
    switch (data.kind) {
      case 'text':
      case 'secret':
      case 'confirm': {
        return askingRow(style.bold(data.message), data.hint, context);
      }
      case 'title': {
        return `${style.bold(data.message)}\n`;
      }
      case 'list': {
        return data.choices.length === 0
          ? `${style.dim('  No matches')}\n`
          : data.choices.map((row) => numberedRow(row, context)).join('');
      }
      case 'issue': {
        return `${style.error(`${glyph.cross} ${literal(data.issue)}`)}\n`;
      }
      default: {
        return askingRow(askingLabels[data.kind], data.hint, context);
      }
    }
  },
});

/**
 * What one progress line's view draws: its state, its counts, its spinner frame, its time, its
 * rate and time left, its log rows, and the tasks under it.
 *
 * @public
 */
interface ProgressLine {
  /** How the line stands: running, ended, failed, cancelled, skipped, or warned. */
  readonly state: 'running' | 'ended' | 'failed' | 'cancelled' | 'skipped' | 'warned';
  /** The label while the line runs, and the end message once it has ended, failed, been skipped, or warned. */
  readonly label: string;
  /** The count of units done, or `undefined` when the work has not counted any. */
  readonly completed: number | undefined;
  /** The count of units the work has, or `undefined` for a spinner. */
  readonly total: number | undefined;
  /** The spinner's current frame. */
  readonly frame: string;
  /** The cells the bar draws for the done and the remaining share. */
  readonly bar: { readonly complete: string; readonly incomplete: string };
  /**
   * Milliseconds since `progress()` or `task()` opened the line: to the frame while it runs, and to
   * its end on an end line, which reads the same at every later frame.
   */
  readonly elapsed: number;
  /**
   * Whether the default view draws the rate and time left: the line's `estimate` setting. A line
   * always supplies it; absent, false.
   */
  readonly estimate?: boolean | undefined;
  /**
   * Units done per second over the line's window: from the latest report at least 10 seconds older
   * than the newest to the newest, so reports a minute apart are measured over that minute. While
   * no report is that old, it is measured from the window's first report: the line's first, or the
   * one whose count went backward and restarted the window. It is `undefined` until there is
   * enough progress. A line always supplies it, whether or not `estimate` is set.
   */
  readonly rate?: number | undefined;
  /**
   * Milliseconds of work left at `rate`, counting down from the newest report and held at 0, or
   * `undefined` while `rate` is `undefined` or 0, without a total, and once `completed` reaches
   * `total`. A line always supplies it, whether or not `estimate` is set.
   */
  readonly remaining?: number | undefined;
  /** What the line counts, as the author wrote it, or `undefined` without one. */
  readonly unit?: string | undefined;
  /**
   * The rows the line draws under it at this frame, already fitted: the newest lines `log()` gave,
   * at most the line's `logRows` and at most its share of the terminal's height, oldest first,
   * each the author's marked text with no line break. The last entry may be an open iterable's
   * unfinished line, and a line cut at the length bound ends with the ellipsis. Empty on an end
   * frame, because every end removes the rows. A line always supplies it; absent, no rows.
   */
  readonly log?: readonly string[] | undefined;
  /**
   * How deep the line sits in its tree: 0 for a line `progress()` opened, and one more than its
   * parent's for a task. The default view indents the line's row two columns for each level and
   * its log rows two columns more. A line always supplies it; absent, 0.
   */
  readonly depth?: number | undefined;
  /**
   * The tasks the line shows under it at this frame, in the order they opened, each with its own
   * data: a running line's running and finished tasks, and an ended line's kept tasks while its
   * tree runs, less the finished ones whose rows give way to the terminal's height. Empty on a
   * root's last frame and on each end line a tree whose tasks stay writes. A line always supplies
   * it; absent, none.
   */
  readonly tasks?: readonly ProgressLine[] | undefined;
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

/** A figure computed in floating point, rounded to 12 significant digits so its digits read true. */
function steady(value: number): number {
  return Number(value.toPrecision(12));
}

/** A rate per second in the largest unit of time it reaches 1 in: per second, minute, or hour. */
function perTime(rate: number): readonly [amount: number, suffix: string] {
  if (rate >= 1) {
    return [rate, '/s'];
  }
  const perMinute = (rate * MINUTE) / SECOND;
  return perMinute >= 1 ? [perMinute, '/min'] : [(rate * HOUR) / SECOND, '/h'];
}

/**
 * A rate in the largest unit of time it reaches 1 in, `/s`, `/min`, or `/h`, rounded down to a whole
 * number from 10 and to one decimal below: `3.3/s`, `15 files/min`, and `0/s` for none.
 */
function rateText(rate: number, unit: string | undefined): string {
  const named = unit === undefined ? '' : ` ${unit}`;
  if (rate === 0) {
    return `0${named}/s`;
  }
  const [amount, suffix] = perTime(rate);
  const shown =
    amount >= 10
      ? String(Math.floor(steady(amount)))
      : (Math.floor(steady(amount * 10)) / 10).toFixed(1);
  return `${shown}${named}${suffix}`;
}

/**
 * A time left in whole seconds rounded up, at least 1, in one unit of time: `about 24s left`,
 * `about 3m left`, and `about 2h left`, minutes and hours rounded half up.
 */
function timeLeft(remaining: number): string {
  const seconds = Math.max(1, Math.ceil(steady(remaining / SECOND)));
  const minutes = Math.floor(seconds / 60 + 0.5);
  let span = `${String(Math.floor(seconds / 3600 + 0.5))}h`;
  if (seconds < 60) {
    span = `${String(seconds)}s`;
  } else if (minutes < 60) {
    span = `${String(minutes)}m`;
  }
  return `about ${span} left`;
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

/** A part of a progress row that can give way on a narrow row, named for its turn to drop. */
type Droppable = 'bar' | 'counts' | 'elapsed' | 'left' | 'rate';

/** One part of a progress row after its label: the marked text it draws and its turn to drop. */
interface LinePart {
  readonly drop: Droppable;
  readonly text: string;
}

/**
 * A progress row in pieces: its mark, the spinner frame or the end glyph, and how the mark is
 * styled; the label; the parts after the label, in drawing order; and how the whole row is styled.
 */
interface LineRow {
  readonly mark: string;
  readonly markStyle: (text: string) => string;
  readonly label: string;
  readonly parts: readonly LinePart[];
  readonly paint: (text: string) => string;
}

/** The parts that drop before the label clips, in their order: the rate, then the time left. */
const DROPPED_FIRST: readonly Droppable[] = ['rate', 'left'];
/** The parts that drop once the label is the ellipsis alone, in their order. */
const DROPPED_LAST: readonly Droppable[] = ['bar', 'elapsed', 'counts'];

/** Text drawn as it is, for a row or a mark that takes no style of its own. */
function asIs(text: string): string {
  return text;
}

/** The pieces of a running line's row: the frame, the label, and its bar, counts, time, and pace. */
function runningRow(data: ProgressLine, context: ViewContext): LineRow {
  const { style } = context;
  const completed = data.completed ?? 0;
  const parts: LinePart[] = [];
  if (data.total !== undefined) {
    const complete = completeCells(completed, data.total);
    const bar =
      style.highlight(textStyle.escape(data.bar.complete.repeat(complete))) +
      style.dim(textStyle.escape(data.bar.incomplete.repeat(BAR_CELLS - complete)));
    parts.push(
      { drop: 'bar', text: ` ${bar}` },
      { drop: 'counts', text: ` ${counts(completed, data.total)}` },
    );
  } else if (data.completed !== undefined) {
    parts.push({ drop: 'counts', text: ` ${String(data.completed)}` });
  }
  parts.push({
    drop: 'elapsed',
    text: ` ${style.dim('·')} ${style.dim(elapsedTime(data.elapsed))}`,
  });
  if (data.estimate === true && data.rate !== undefined) {
    parts.push({
      drop: 'rate',
      text: ` ${style.dim('·')} ${style.dim(rateText(data.rate, data.unit))}`,
    });
    if (data.remaining !== undefined) {
      parts.push({
        drop: 'left',
        text: ` ${style.dim('·')} ${style.dim(timeLeft(data.remaining))}`,
      });
    }
  }
  return {
    label: data.label,
    mark: textStyle.escape(data.frame),
    markStyle: style.highlight,
    paint: asIs,
    parts,
  };
}

/** The pieces of a progress line's row in its state: its glyph or frame, label, and parts. */
function rowOf(data: ProgressLine, context: ViewContext): LineRow {
  const { style } = context;
  const time: LinePart = {
    drop: 'elapsed',
    text: ` ${style.dim('·')} ${style.dim(elapsedTime(data.elapsed))}`,
  };
  const ended = (mark: string, markStyle: (text: string) => string): LineRow => ({
    label: data.label,
    mark,
    markStyle,
    paint: asIs,
    parts: [time],
  });
  const rows: Readonly<Record<ProgressLine['state'], () => LineRow>> = {
    cancelled: () => ({
      label: data.label,
      mark: glyph.squareCenter,
      markStyle: asIs,
      paint: style.dim,
      parts: [{ drop: 'elapsed', text: ' (cancelled)' }],
    }),
    ended: () => ended(glyph.success, style.success),
    failed: () => ended(glyph.error, style.error),
    running: () => runningRow(data, context),
    skipped: () => ({
      label: data.label,
      mark: glyph.info,
      markStyle: asIs,
      paint: style.dim,
      parts: [{ drop: 'elapsed', text: ` · ${elapsedTime(data.elapsed)}` }],
    }),
    warned: () => ended(glyph.warning, style.warning),
  };
  return rows[data.state]();
}

/**
 * A progress line's row after two spaces for each level of `depth`. A row the view `fits` keeps to
 * one row of `columns`, or 80 where it is unknown, measured with its indent: the rate drops, then
 * the time left, then the label clips to its leading graphemes and the ellipsis, down to the
 * ellipsis alone, then the bar, the elapsed time, and the counts drop, and at the narrowest the row
 * is its leading columns that fit. Any other row draws whole, and the terminal wraps a long one.
 */
function lineRow(
  data: ProgressLine,
  { depth, fits }: { readonly depth: number; readonly fits: boolean },
  context: ViewContext,
): string {
  const { width } = context;
  const indent = '  '.repeat(depth);
  const row = rowOf(data, context);
  const text = (label: string, parts: readonly LinePart[]) =>
    `${row.markStyle(row.mark)} ${label}${parts.map((part) => part.text).join('')}`;
  const drawn = (label: string, parts: readonly LinePart[]) =>
    indent + row.paint(text(label, parts));
  if (!fits) {
    return drawn(row.label, row.parts);
  }
  const columns = Math.max(1, context.columns ?? 80);
  const within = (label: string, parts: readonly LinePart[]) =>
    width(indent + text(label, parts)) <= columns;
  const ellipsis = context.plain(glyph.ellipsis);
  // A label that holds a line break would draw a second row, so its first line stands for it.
  const plain = context.plain(row.label);
  const [first = ''] = plain.split('\n', 1);
  const label = first === plain ? row.label : literal(first + ellipsis);
  let parts = row.parts;
  for (const drop of DROPPED_FIRST) {
    if (within(label, parts)) {
      return drawn(label, parts);
    }
    parts = parts.filter((part) => part.drop !== drop);
  }
  if (within(label, parts)) {
    return drawn(label, parts);
  }
  const room = columns - width(indent + text('', parts));
  if (room >= width(literal(ellipsis))) {
    const kept = leading(first, room - width(literal(ellipsis)), (candidate) =>
      width(literal(candidate)),
    );
    return drawn(literal(kept + ellipsis), parts);
  }
  for (const drop of DROPPED_LAST) {
    parts = parts.filter((part) => part.drop !== drop);
    if (within(literal(ellipsis), parts)) {
      return drawn(literal(ellipsis), parts);
    }
  }
  // The row is its leading columns that fit, each piece keeping its own style.
  const pieces: [string, (text: string) => string][] = [
    [indent, asIs],
    [context.plain(row.mark), (piece) => row.markStyle(textStyle.escape(piece))],
    [' ', asIs],
    [ellipsis, (piece) => textStyle.escape(piece)],
  ];
  let left = columns;
  let fitted = '';
  for (const [piece, draw] of pieces) {
    const kept = leading(piece, left, (candidate) => width(textStyle.escape(candidate)));
    fitted += kept === '' ? '' : draw(kept);
    if (kept !== piece) {
      break;
    }
    left -= width(textStyle.escape(kept));
  }
  return row.paint(fitted);
}

/**
 * The rows of one line and the tasks under it: its row after two spaces for each level of its
 * depth, its log rows two spaces further in, and then each task's rows by the same rules. A running
 * line's row and every row drawn under it keep to one row each; `fits` says a running line is
 * above this one.
 */
function treeRows(data: ProgressLine, context: ViewContext, fits = false): string[] {
  const depth = Math.max(0, data.depth ?? 0);
  const fitted = fits || data.state === 'running';
  const rows = (data.log ?? []).map((entry) => context.style.dim(logRow(entry, context, depth)));
  const tasks = (data.tasks ?? []).flatMap((task) => treeRows(task, context, fitted));
  return [lineRow(data, { depth, fits: fitted }, context), ...rows, ...tasks];
}

/**
 * The declared view that draws one progress line, for a `ProgressLine`. An application restyles it
 * with `override`.
 *
 * @example
 * ```ts
 * import { Command } from '@loomcli/core';
 * import { progressLine } from '@loomcli/prompts/views';
 *
 * export const preview = new Command('preview').action(async (context) => {
 *   await context.out.draw(
 *     {
 *       state: 'running',
 *       label: 'Fetching records',
 *       completed: 6,
 *       total: 10,
 *       frame: '◐',
 *       bar: { complete: '▰', incomplete: '▱' },
 *       elapsed: 2400,
 *     },
 *     progressLine,
 *   );
 * });
 * ```
 *
 * @see https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md#progress-view
 * @public
 */
const progressLine = view<ProgressLine>('@loomcli/prompts/progress', {
  render: (data, context) => treeRows(data, context).join('\n'),
});

export { answeredLine, cancelledLine, progressLine, questionFrame, questionLine };
export type {
  AnsweredLine,
  NumberedChoice,
  QuestionLine,
  CancelledLine,
  ProgressLine,
  QuestionFrame,
  TypedFrame,
  EditorFrame,
  ListFrame,
  ChoiceRow,
  SeparatorRow,
};
