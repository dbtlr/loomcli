import { glyph, pad } from '@loomcli/core';
import type { View, ViewContext } from '@loomcli/core';

import { blank, wrappedLines } from './text-lines.js';

const EMPTY = 0;
const FIRST_POSITION = 1;
const MARKER_GAP = ' ';
const TOP_LEVEL = 0;

interface ListConfig<Item> {
  readonly ordered?: boolean;
  readonly format?: (item: Item, index: number, context: ViewContext) => string;
  readonly children?: (item: Item) => readonly Item[] | undefined;
}

/** What every level of one render reads: the list's configuration and the render's context. */
interface ListLayout<Item> {
  readonly config: ListConfig<Item>;
  readonly context: ViewContext;
}

/** An item escaped and styled by the view, with absence rendered as empty text. */
function defaultText(item: unknown, context: ViewContext): string {
  // `String(item)` is the documented item coercion, the table's cell rule.
  // oxlint-disable-next-line typescript/no-base-to-string
  const text = item === null || item === undefined ? '' : String(item);
  return context.style.primary(context.style.escape(text));
}

/** Each sibling's marker: a bullet, or its position counting from 1 and a period. */
function markersOf(count: number, ordered: boolean): string[] {
  return Array.from({ length: count }, (_unused, index) =>
    ordered ? `${String(index + FIRST_POSITION)}.` : glyph.bullet,
  );
}

/**
 * One level of siblings as lines, each item's nested items after it. Markers right-align to the
 * widest among the siblings, and every line of an item's text after its first hangs at the text
 * column, except a blank one, which stays bare. A nested level starts at its parent's text column.
 */
function levelLines<Item>(
  items: readonly Item[],
  indent: number,
  layout: ListLayout<Item>,
): string[] {
  const { config, context } = layout;
  const markers = markersOf(items.length, config.ordered === true);
  let markerWidth = EMPTY;
  for (const marker of markers) {
    markerWidth = Math.max(markerWidth, context.width(marker));
  }
  const margin = ' '.repeat(indent);
  const textColumn = indent + markerWidth + MARKER_GAP.length;
  const hang = ' '.repeat(textColumn);
  return items.flatMap((item, index) => {
    const text = config.format ? config.format(item, index, context) : defaultText(item, context);
    const [first = '', ...rest] = wrappedLines(text, context, textColumn);
    const marker = context.style.dim(pad(markers[index] ?? '', markerWidth, { align: 'right' }));
    const nested = config.children?.(item) ?? [];
    return [
      blank(first, context) ? `${margin}${marker}` : `${margin}${marker}${MARKER_GAP}${first}`,
      ...rest.map((line) => (blank(line, context) ? line : `${hang}${line}`)),
      ...(nested.length === EMPTY ? [] : levelLines(nested, textColumn, layout)),
    ];
  });
}

/**
 * A whole view over items, bulleted or numbered, with nested items under their parent's text and
 * every item's text wrapped under itself on a terminal. The returned value is a bare pack view and
 * installs no plugin behavior.
 */
function list<Item>(config: ListConfig<Item> = {}): View<readonly Item[]> {
  return {
    render: (items, context) => {
      const lines = levelLines(items, TOP_LEVEL, { config, context });
      return lines.length === EMPTY ? '' : `${lines.join('\n')}\n`;
    },
  };
}

export { list };
export type { ListConfig };
