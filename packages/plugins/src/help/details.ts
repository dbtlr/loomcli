import { nowrap } from '@loomcli/core';
import type { ViewContext } from '@loomcli/core';

import { parseMarkdown } from '../markdown/blocks.js';
import type { Block, Item } from '../markdown/blocks.js';
import type { Inline } from '../markdown/inline.js';
import { proseLines } from './layout.js';

type Style = ViewContext['style'];
interface Modifiers {
  bold: boolean;
  italic: boolean;
}

/**
 * How a block renders: the page's style, the view context, and the columns left for the block's
 * text after the page indent and its containers' markers. The width is undefined off a terminal,
 * where nothing reflows and each authored line stays one page line.
 */
interface Layout {
  readonly context: ViewContext;
  readonly style: Style;
  readonly width: number | undefined;
}

const firstElement = 0;
const lastLineOffset = -1;
const continuationStart = 1;
const markerSpaceWidth = 1;
const emptyLength = 0;
const pageIndent = '  ';
const quotePrefixWidth = 2;

const ordinary: Modifiers = { bold: false, italic: false };

/** Applies semantic color and surrounding modifiers after escaping each authored fragment. */
function styled(
  text: string,
  token: 'primary' | 'highlight' | 'dim',
  { modifiers, style }: { modifiers: Modifiers; style: Style },
): string {
  const value = style.escape(text);
  const color = style[token];
  if (modifiers.bold && modifiers.italic) {
    return color.bold.italic(value);
  }
  if (modifiers.bold) {
    return color.bold(value);
  }
  return modifiers.italic ? color.italic(value) : color(value);
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
  return layout.width === undefined ? line : layout.context.expandTabs(line);
}

/**
 * Text that reflows. Off a terminal each authored line is one page line. On a terminal the lines
 * join with one space, Markdown's soft line break, and wrap at the width left for them.
 */
function reflow(lines: readonly string[], layout: Layout): string[] {
  if (layout.width === undefined) {
    return [...lines];
  }
  const joined = lines.map((line) => expanded(line, layout)).join(' ');
  return proseLines(joined, layout.width, layout.context);
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
  const span = styled(codeSpan(node), 'highlight', { modifiers, style: layout.style });
  return layout.width === undefined ? span : nowrap(span);
}

/** Inline nodes inherit modifiers; code and destinations replace only the semantic color. */
function inline(nodes: readonly Inline[], modifiers: Modifiers, layout: Layout): string {
  return nodes
    .map((node): string => {
      switch (node.kind) {
        case 'text':
        case 'address': {
          return styled(node.text, 'primary', { modifiers, style: layout.style });
        }
        case 'code': {
          return codeText(node, modifiers, layout);
        }
        case 'emphasis': {
          return inline(
            node.children,
            { bold: modifiers.bold || node.strong, italic: modifiers.italic || !node.strong },
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
  const { style } = layout;
  if (plain(node.children) === node.destination) {
    return styled(node.destination, 'primary', { modifiers, style });
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
      : `  ${expanded(styled(line, 'highlight', { modifiers: ordinary, style: layout.style }), layout)}`,
  );
}

/** Rendered marker widths, rather than source columns, indent item continuations. */
function listLines(block: Extract<Block, { kind: 'list' }>, layout: Layout): string[] {
  return block.items.flatMap((item, index) => {
    const marker =
      block.marker.kind === 'ordered'
        ? `${block.marker.start + index}${block.marker.delimiter}`
        : '-';
    const separator = item.blankBefore && index > firstElement ? [''] : [];
    return [...separator, ...itemLines(marker, item, layout)];
  });
}

/**
 * A marker's printed width, including its space, indents every subsequent content line, so a
 * wrapped line continues under the item's text.
 */
function itemLines(marker: string, item: Item, layout: Layout): string[] {
  const indent = marker.length + markerSpaceWidth;
  const content = blockLines(item.blocks, within(layout, indent));
  const first = content[firstElement];
  const prefix = styled(marker, 'dim', { modifiers: ordinary, style: layout.style });
  return [
    prefix + (first === undefined || first === '' ? '' : ` ${first}`),
    ...content
      .slice(continuationStart)
      .map((line) => (line === '' ? '' : ' '.repeat(indent) + line)),
  ];
}

/**
 * Each block produces container-relative lines; only authored separators introduce blanks. A
 * paragraph and a heading reflow, and a quote's `> ` starts each of its lines, wrapped ones too.
 */
function renderBlock(block: Block, layout: Layout): string[] {
  const { style } = layout;
  switch (block.kind) {
    case 'paragraph': {
      return reflow(
        block.lines.map((line) => inline(line, ordinary, layout)),
        layout,
      );
    }
    case 'heading': {
      return reflow([inline(block.text, { bold: true, italic: false }, layout)], layout);
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
    style: context.style,
    width: context.columns === undefined ? undefined : context.columns - pageIndent.length,
  };
  return blockLines(parseMarkdown(source), layout).map((line) =>
    line === '' ? '' : `${pageIndent}${line}`,
  );
}

export { renderDetails };
