import { nowrap, splitLines } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

import { parseMarkdown } from '../markdown/blocks.js';
import type { Block, Item } from '../markdown/blocks.js';
import type { Inline } from '../markdown/inline.js';
import { headingLines, itemLine, itemMarkers, terminalWrap } from '../text-lines.js';
import { hangLines, onTerminal, proseRoom } from './layout.js';

type Style = ViewContext['style'];
interface Modifiers {
  bold: boolean;
  italic: boolean;
  // Plain text takes no color of its own, so a heading's `dim` shows through it.
  body: 'primary' | 'plain';
}

/**
 * How a block renders: the view context, and the columns left for the block's text after the page
 * indent and its containers' markers. The width is defined exactly on a terminal, and off one
 * nothing reflows and each authored line stays one page line.
 */
interface Layout {
  readonly context: ViewContext;
  readonly width: number | undefined;
}

const firstElement = 0;
const lastLineOffset = -1;
const continuationStart = 1;
const emptyLength = 0;
const pageIndent = '  ';
const quotePrefixWidth = 2;
const listIndent = 0;

const ordinary: Modifiers = { body: 'primary', bold: false, italic: false };
const headingText: Modifiers = { body: 'plain', bold: false, italic: false };

/** Applies semantic color and surrounding modifiers after escaping each authored fragment. */
function styled(
  text: string,
  token: 'primary' | 'highlight' | 'dim' | 'plain',
  { modifiers, style }: { modifiers: Modifiers; style: Style },
): string {
  const value = style.escape(text);
  if (token === 'plain') {
    return plainText(value, modifiers, style);
  }
  const color = style[token];
  if (modifiers.bold && modifiers.italic) {
    return color.bold.italic(value);
  }
  if (modifiers.bold) {
    return color.bold(value);
  }
  return modifiers.italic ? color.italic(value) : color(value);
}

/** Escaped text with the surrounding modifiers and no color. */
function plainText(value: string, modifiers: Modifiers, style: Style): string {
  if (modifiers.bold && modifiers.italic) {
    return style.bold.italic(value);
  }
  if (modifiers.bold) {
    return style.bold(value);
  }
  return modifiers.italic ? style.italic(value) : value;
}

/** The layout of a container's content, which has `used` fewer columns than the container. */
function within(layout: Layout, used: number): Layout {
  return { ...layout, width: layout.width === undefined ? undefined : layout.width - used };
}

/**
 * One rendered authored line as a terminal shows it, its tabs expanded from the line's start. Off
 * a terminal the line keeps its tabs.
 */
function expanded(line: string, layout: Layout): string {
  return onTerminal(layout.context) ? layout.context.expandTabs(line) : line;
}

/**
 * Text that reflows. Off a terminal each authored line is one page line. On a terminal the lines
 * join with one space, Markdown's soft line break, and wrap at the width left for them.
 */
function reflow(lines: readonly string[], layout: Layout): string[] {
  if (layout.width === undefined) {
    return [...lines];
  }
  return splitLines(terminalWrap(joined(lines, layout), layout.context, proseRoom(layout.width)));
}

/** Rendered authored lines as one text, joined with one space after each expands its tabs. */
function joined(lines: readonly string[], layout: Layout): string {
  return lines.map((line) => expanded(line, layout)).join(' ');
}

/** The rendered lines of a block that reflows, a paragraph or a heading, or none for another. */
function reflowing(block: Block | undefined, layout: Layout): string[] | undefined {
  if (block?.kind === 'paragraph') {
    return block.lines.map((line) => inline(line, ordinary, layout));
  }
  return block?.kind === 'heading' ? [inline(block.text, headingText, layout)] : undefined;
}

/** A paragraph's or a heading's reflowed lines as they print. */
function reflowed(block: Block, layout: Layout): string[] {
  return headed(block, reflow(reflowing(block, layout) ?? [], layout), layout.context);
}

/**
 * A block's reflowed lines as they print. A heading prints as the Heading view does, `dim`, with an
 * underline at level 1, and a paragraph's lines are as they are.
 */
function headed(block: Block, lines: readonly string[], context: ViewContext): string[] {
  return block.kind === 'heading' ? headingLines(lines, block.level, context) : [...lines];
}

/** The authored lines of table rows, which keep their lines on a terminal and off one. */
function tableLines(block: Extract<Block, { kind: 'table' }>, layout: Layout): string[] {
  return block.lines.map((line) => expanded(inline(line, ordinary, layout), layout));
}

/** Help keeps a code span's authored backtick run around its uninterpreted content. */
function codeSpan(node: Extract<Inline, { kind: 'code' }>): string {
  const backticks = '`'.repeat(node.backtickLength);
  return backticks + node.content + backticks;
}

/** Link equality compares printable text, independently of marked strings and theme policy. */
function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((node): string => {
      if (node.kind === 'emphasis') {
        return plain(node.children);
      }
      if (node.kind === 'link' || node.kind === 'image') {
        const text = plain(node.children);
        return text === node.destination ? text : `${text} (${node.destination})`;
      }
      return node.kind === 'code' ? codeSpan(node) : node.text;
    })
    .join('');
}

/**
 * A code span as help prints it. On a terminal it sits in `nowrap`, so wrapping never breaks it.
 */
function codeText(
  node: Extract<Inline, { kind: 'code' }>,
  modifiers: Modifiers,
  layout: Layout,
): string {
  const span = styled(codeSpan(node), 'highlight', { modifiers, style: layout.context.style });
  return onTerminal(layout.context) ? nowrap(span) : span;
}

/** Inline nodes inherit modifiers; code and destinations replace only the semantic color. */
function inline(nodes: readonly Inline[], modifiers: Modifiers, layout: Layout): string {
  return nodes
    .map((node): string => {
      switch (node.kind) {
        case 'text':
        case 'address': {
          return styled(node.text, modifiers.body, { modifiers, style: layout.context.style });
        }
        case 'code': {
          return codeText(node, modifiers, layout);
        }
        case 'emphasis': {
          return inline(
            node.children,
            {
              body: modifiers.body,
              bold: modifiers.bold || node.strong,
              italic: modifiers.italic || !node.strong,
            },
            layout,
          );
        }
        case 'image':
        case 'link': {
          return link(node, modifiers, layout);
        }
        default: {
          const exhaustive: never = node;
          return exhaustive;
        }
      }
    })
    .join('');
}

/** Images use link layout; a destination is dim unless it prints alone in the surrounding style. */
function link(
  node: Extract<Inline, { kind: 'link' | 'image' }>,
  modifiers: Modifiers,
  layout: Layout,
): string {
  const { style } = layout.context;
  if (plain(node.children) === node.destination) {
    return styled(node.destination, modifiers.body, { modifiers, style });
  }
  const text = inline(node.children, modifiers, layout);
  const space = style.escape(' ');
  const separator = modifiers.bold ? style.bold(space) : space;
  return (
    text +
    (modifiers.italic ? style.italic(separator) : separator) +
    styled(`(${node.destination})`, 'dim', { modifiers, style })
  );
}

/**
 * Drops empty edges and trailing whitespace before a code line becomes a single styled value. Code
 * never wraps, and on a terminal each line's tabs expand from its own start.
 */
function codeLines(lines: readonly string[], layout: Layout): string[] {
  const content = lines.map((line) => line.trimEnd());
  while (content[firstElement] === '') {
    content.shift();
  }
  while (content.at(lastLineOffset) === '') {
    content.pop();
  }
  return content.map((line) =>
    line === ''
      ? ''
      : `  ${expanded(styled(line, 'highlight', { modifiers: ordinary, style: layout.context.style }), layout)}`,
  );
}

/** One item's marker and the columns from its start to the item's text. */
interface Marker {
  readonly indent: number;
  readonly marker: string;
}

/**
 * A list's items with the markers the List view prints: bullets, or numbers counting from the
 * authored start with a period. The widest marker, rather than a source column, indents item
 * continuations.
 */
function listLines(block: Extract<Block, { kind: 'list' }>, layout: Layout): string[] {
  const { markers, textOffset } = itemMarkers(
    block.items.length,
    block.marker.kind === 'ordered' ? block.marker.start : undefined,
    layout.context,
  );
  return block.items.flatMap((item, index) => {
    const separator = item.blankBefore && index > firstElement ? [''] : [];
    return [
      ...separator,
      ...itemLines({ indent: textOffset, marker: markers[index] ?? '' }, item, layout),
    ];
  });
}

/**
 * A marker's printed width, including its space, indents every subsequent content line, so a
 * wrapped line continues under the item's text, unless the item's opening text cannot hang there.
 */
function itemLines({ indent, marker }: Marker, item: Item, layout: Layout): string[] {
  const content = blockLines(item.blocks, within(layout, indent));
  const fallback = fallbackLines(item, indent, layout);
  // A fallback stands in for the opening block's lines, and its continuation lines take no indent.
  const [first, ...unindented] = fallback?.lines ?? content.slice(firstElement, continuationStart);
  const later = content.slice(fallback?.replaces ?? continuationStart);
  return [
    itemLine(marker, first ?? '', layout.context),
    ...unindented,
    ...later.map((line) => (line === '' ? '' : ' '.repeat(indent) + line)),
  ];
}

/**
 * An item's opening paragraph or heading when its hang after the marker cannot fit: its first line,
 * then its continuation lines, which start at the list's own indent, where the marker starts, and
 * the number of the item's lines they stand in for. Otherwise none, and every line of the item
 * hangs under its text.
 */
function fallbackLines(
  item: Item,
  indent: number,
  layout: Layout,
): { lines: string[]; replaces: number } | undefined {
  const [opening] = item.blocks;
  const lines = reflowing(opening, layout);
  if (opening === undefined || lines === undefined || layout.width === undefined) {
    return undefined;
  }
  const hung = hangLines(
    joined(lines, layout),
    { base: listIndent, columns: layout.width, lead: indent },
    layout.context,
  );
  return hung.indent === indent
    ? undefined
    : {
        lines: headed(opening, [hung.first, ...hung.rest], layout.context),
        replaces: renderBlock(opening, within(layout, indent)).length,
      };
}

/**
 * Each block produces container-relative lines; only authored separators introduce blanks. A
 * paragraph and a heading reflow, and a quote's `> ` starts each of its lines, wrapped ones too.
 */
function renderBlock(block: Block, layout: Layout): string[] {
  const { style } = layout.context;
  switch (block.kind) {
    case 'paragraph':
    case 'heading': {
      return reflowed(block, layout);
    }
    case 'table': {
      return tableLines(block, layout);
    }
    case 'code': {
      return codeLines(block.lines, layout);
    }
    case 'break': {
      return [expanded(styled(block.text, 'primary', { modifiers: ordinary, style }), layout)];
    }
    case 'list': {
      return listLines(block, layout);
    }
    case 'quote': {
      return blockLines(block.blocks, within(layout, quotePrefixWidth)).map(
        (line) =>
          styled('>', 'dim', { modifiers: ordinary, style }) + (line === '' ? '' : ` ${line}`),
      );
    }
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

/** Empty rendered blocks do not create spacing, but their authored separator still carries through. */
function blockLines(blocks: readonly Block[], layout: Layout): string[] {
  const state: { blankBefore: boolean; lines: string[] } = { blankBefore: false, lines: [] };
  for (const block of blocks) {
    appendBlock(state, block, layout);
  }
  return state.lines;
}

/** Empty blocks carry their authored separator forward without adding page lines. */
function appendBlock(
  state: { blankBefore: boolean; lines: string[] },
  block: Block,
  layout: Layout,
): void {
  state.blankBefore ||= block.blankBefore;
  const content = renderBlock(block, layout);
  if (content.length === emptyLength) {
    return;
  }
  if (state.blankBefore && state.lines.length > emptyLength) {
    state.lines.push('');
  }
  state.lines.push(...content);
  state.blankBefore = false;
}

/**
 * Details alone may hold authored blank lines; every nonblank page line gains two spaces. On a
 * terminal the text wraps at the columns left after those two spaces and its containers' markers.
 */
function renderDetails(source: string, context: ViewContext): string[] {
  const layout: Layout = {
    context,
    width: onTerminal(context) ? context.columns - pageIndent.length : undefined,
  };
  return blockLines(parseMarkdown(source), layout).map((line) =>
    line === '' ? '' : `${pageIndent}${line}`,
  );
}

export { renderDetails };
