import { glyph, pad, splitLines } from '@loomcli/core';
import type { View, ViewContext } from '@loomcli/core';

/** The columns a frame takes from a line: a border and a space on each side. */
const FRAME = 4;
const NARROWEST = 1;
const NO_TITLE = 0;
/** The columns beside a content line's width that run between the corners: one space each side. */
const SIDES = 2;
/** The columns a title adds to the inner width: the space after it and at least one line. */
const TITLE_ROOM = 2;
/** The columns a title takes from the top border besides its own: a line, a space, and a space. */
const TITLE_FRAME = 3;

type BoxConfig<Data> = { readonly title?: string } & ([Data] extends [string]
  ? { readonly content?: View<Data> }
  : { readonly content: View<Data> });

/**
 * The text a box with no content frames. On a terminal its tabs expand and it wraps at the columns
 * the box offers. A box takes no content only when its data is a string, so other data frames
 * nothing.
 */
const framedText: View<unknown> = {
  render: (data, context) => {
    if (typeof data !== 'string') {
      return '';
    }
    return context.columns === undefined
      ? data
      : context.wrap(context.expandTabs(data), context.columns);
  },
};

/** The context a box hands its content: its own, with `columns` narrowed by the frame. */
function innerContext(context: ViewContext): ViewContext {
  const { columns } = context;
  return {
    ...context,
    columns: columns === undefined ? undefined : Math.max(NARROWEST, columns - FRAME),
  };
}

/** The top border, which carries the title, when there is one, styled `primary` and `bold`. */
function topBorder(
  context: ViewContext,
  { inner, title }: { inner: number; title: string | undefined },
): string {
  const { dim } = context.style;
  if (title === undefined) {
    return dim(
      `${glyph.lineDownRightArc}${glyph.line.repeat(inner + SIDES)}${glyph.lineDownLeftArc}`,
    );
  }
  const rest = inner + SIDES - TITLE_FRAME - context.width(title);
  return `${dim(`${glyph.lineDownRightArc}${glyph.line} `)}${context.style.primary.bold(title)}${dim(
    ` ${glyph.line.repeat(rest)}${glyph.lineDownLeftArc}`,
  )}`;
}

/**
 * Rendered content in its frame. On a terminal its tabs expand before it is measured, and off one
 * each line's `pad` frame expands them from the line's start, so the right border keeps its
 * column. The inner width is the widest line, or the title's width and two when that is wider.
 */
function framed(
  rendered: string,
  { context, title }: { context: ViewContext; title: string | undefined },
): string {
  const lines = splitLines(context.columns === undefined ? rendered : context.expandTabs(rendered));
  let inner = title === undefined ? NO_TITLE : context.width(title) + TITLE_ROOM;
  for (const line of lines) {
    inner = Math.max(inner, context.width(line));
  }
  const { dim } = context.style;
  const side = dim(glyph.lineVertical);
  const bottom = dim(
    `${glyph.lineUpRightArc}${glyph.line.repeat(inner + SIDES)}${glyph.lineUpLeftArc}`,
  );
  return `${[
    topBorder(context, { inner, title }),
    ...lines.map((line) => `${side} ${pad(line, inner)} ${side}`),
    bottom,
  ].join('\n')}\n`;
}

/**
 * A view that frames text, or the output of another view, in a rounded border with an optional
 * title in its top border. With no `content` it frames its text, wrapped on a terminal at
 * `columns` less the frame. With `content` it renders the content with `columns` narrowed by the
 * frame, so a framed table shrinks to fit inside it. The returned value is a bare pack view and
 * installs no plugin behavior.
 */
function box<Data = string>(
  ...config: [Data] extends [string] ? [config?: BoxConfig<Data>] : [config: BoxConfig<Data>]
): View<Data> {
  const [settings] = config;
  const content: View<Data> = settings?.content ?? framedText;
  const title = settings?.title;
  return {
    render: (data, context) => {
      const rendered = content.render(data, innerContext(context));
      return rendered === '' ? '' : framed(rendered, { context, title });
    },
  };
}

export { box };
export type { BoxConfig };
