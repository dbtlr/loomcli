import type { ViewContext } from '@loomcli/core';

import { parseMarkdown } from '../markdown/blocks.js';
import type { Block, Item } from '../markdown/blocks.js';
import type { Inline } from '../markdown/inline.js';

type Style = ViewContext['style'];
interface Modifiers {
  bold: boolean;
  italic: boolean;
}
const ordinary: Modifiers = { bold: false, italic: false };

const firstIndex = 0;
const lastIndex = -1;
const step = 1;

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

/** Link equality compares printable text, independently of marked strings and theme policy. */
function plain(nodes: readonly Inline[]): string {
  return nodes
    .map((node): string => {
      if (node.kind === 'emphasis') {
        return plain(node.children);
      }
      if (node.kind === 'link') {
        const text = plain(node.children);
        return text === node.destination ? text : `${text} (${node.destination})`;
      }
      return node.text;
    })
    .join('');
}

/** Inline nodes inherit modifiers; code and destinations replace only the semantic color. */
function inline(nodes: readonly Inline[], modifiers: Modifiers, style: Style): string {
  return nodes
    .map((node): string => {
      switch (node.kind) {
        case 'text':
        case 'address': {
          return styled(node.text, 'primary', { modifiers, style });
        }
        case 'code': {
          return styled(node.text, 'highlight', { modifiers, style });
        }
        case 'emphasis': {
          return inline(
            node.children,
            { bold: modifiers.bold || node.strong, italic: modifiers.italic || !node.strong },
            style,
          );
        }
        case 'link': {
          return link(node, modifiers, style);
        }
        default: {
          const exhaustive: never = node;
          return exhaustive;
        }
      }
    })
    .join('');
}

/** A destination is dim, but its separating space carries only the inherited modifiers. */
function link(node: Extract<Inline, { kind: 'link' }>, modifiers: Modifiers, style: Style): string {
  const text = inline(node.children, modifiers, style);
  if (plain(node.children) === node.destination) {
    return text;
  }
  const space = style.escape(' ');
  const separator = modifiers.bold ? style.bold(space) : space;
  return (
    text +
    (modifiers.italic ? style.italic(separator) : separator) +
    styled(`(${node.destination})`, 'dim', { modifiers, style })
  );
}

/** Drops empty edges and trailing whitespace before a code line becomes a single styled value. */
function codeLines(lines: readonly string[], style: Style): string[] {
  const content = lines.map((line) => line.trimEnd());
  while (content[firstIndex] === '') {
    content.shift();
  }
  while (content.at(lastIndex) === '') {
    content.pop();
  }
  return content.map((line) =>
    line === '' ? '' : `  ${styled(line, 'highlight', { modifiers: ordinary, style })}`,
  );
}

/** Rendered marker widths, rather than source columns, indent item continuations. */
function listLines(block: Extract<Block, { kind: 'list' }>, style: Style): string[] {
  return block.items.flatMap((item, index) => {
    const marker =
      block.marker.kind === 'ordered'
        ? `${block.marker.start + index}${block.marker.delimiter}`
        : '-';
    const separator = item.blankBefore && index > firstIndex ? [''] : [];
    return [...separator, ...itemLines(marker, item, style)];
  });
}

/** A marker's printed width, including its space, indents every subsequent content line. */
function itemLines(marker: string, item: Item, style: Style): string[] {
  const content = blockLines(item.blocks, style);
  const first = content[firstIndex];
  const prefix = styled(marker, 'dim', { modifiers: ordinary, style });
  return [
    prefix + (first === undefined || first === '' ? '' : ` ${first}`),
    ...content
      .slice(step)
      .map((line) => (line === '' ? '' : ' '.repeat(marker.length + step) + line)),
  ];
}

/** Each block produces container-relative lines; only authored separators introduce blanks. */
function renderBlock(block: Block, style: Style): string[] {
  switch (block.kind) {
    case 'paragraph': {
      return block.lines.map((line) => inline(line, ordinary, style));
    }
    case 'heading': {
      return block.text.length === firstIndex
        ? []
        : [inline(block.text, { bold: true, italic: false }, style)];
    }
    case 'code': {
      return codeLines(block.lines, style);
    }
    case 'break': {
      return [styled(block.text, 'primary', { modifiers: ordinary, style })];
    }
    case 'list': {
      return listLines(block, style);
    }
    case 'quote': {
      return blockLines(block.blocks, style).map(
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
function blockLines(blocks: readonly Block[], style: Style): string[] {
  const state: { blankBefore: boolean; lines: string[] } = { blankBefore: false, lines: [] };
  for (const block of blocks) {
    appendBlock(state, block, style);
  }
  return state.lines;
}

/** Empty blocks carry their authored separator forward without adding page lines. */
function appendBlock(
  state: { blankBefore: boolean; lines: string[] },
  block: Block,
  style: Style,
): void {
  state.blankBefore ||= block.blankBefore;
  const content = renderBlock(block, style);
  if (content.length === firstIndex) {
    return;
  }
  if (state.blankBefore && state.lines.length > firstIndex) {
    state.lines.push('');
  }
  state.lines.push(...content);
  state.blankBefore = false;
}

/** Details alone may hold authored blank lines; every nonblank page line gains two spaces. */
function renderDetails(source: string, { style }: ViewContext): string[] {
  return blockLines(parseMarkdown(source), style).map((line) => (line === '' ? '' : `  ${line}`));
}

export { renderDetails };
