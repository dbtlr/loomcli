import type { ViewContext } from './types.js';

/**
 * The message laid out right of a gutter `width` columns wide: on a terminal its tabs expand to
 * spaces first, so the gutter cannot move a tab stop, and it wraps at the columns right of the
 * gutter when any are left, each continuation line indented under the message. Off a terminal it
 * is unchanged.
 */
function underGutter(message: string, context: ViewContext, width: number): string {
  const gutter = ' '.repeat(width);
  const room = context.columns === undefined ? 0 : context.columns - width;
  const laid = context.columns === undefined ? message : context.expandTabs(message);
  const wrapped = room > 0 ? context.wrap(laid, room) : laid;
  return wrapped.replace(/(?<newline>\r?\n)(?!$)/gu, `$<newline>${gutter}`);
}

export { underGutter };
