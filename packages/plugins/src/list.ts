import type { View, ViewContext } from '@loomcli/core';

import { continuation, dataText, itemLine, itemMarkers, wrappedLines } from './text-lines.js';

const EMPTY = 0;
const FIRST_POSITION = 1;
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
  const { markers, textOffset } = itemMarkers(
    items.length,
    config.ordered === true ? FIRST_POSITION : undefined,
    context,
  );
  const margin = ' '.repeat(indent);
  const textColumn = indent + textOffset;
  const hang = ' '.repeat(textColumn);
  return items.flatMap((item, index) => {
    const text = config.format ? config.format(item, index, context) : dataText(item, context);
    const [first = '', ...rest] = wrappedLines(text, context, textColumn);
    const nested = config.children?.(item) ?? [];
    return [
      `${margin}${itemLine(markers[index] ?? '', first, context)}`,
      ...rest.map((line) => continuation(line, hang, context)),
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
