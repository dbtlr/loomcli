/*
 * A Command's Markdown details in roff's own way: man fills a paragraph and wraps it to the
 * reader's width, so the author's line breaks inside a paragraph are not kept, while code keeps
 * every line. The details are parsed with the parser help uses.
 */
import { isEmpty } from '../help/cells.js';
import { parseMarkdown } from '../markdown/blocks.js';
import type { Block, Item } from '../markdown/blocks.js';
import type { Inline } from '../markdown/inline.js';
import { escapeText, request, textLine, writeRuns } from './roff.js';
import type { Font, Run } from './roff.js';

/** The fonts that surround an inline construct. */
interface Modifiers {
  readonly bold: boolean;
  readonly italic: boolean;
}

const regular: Modifiers = { bold: false, italic: false };
const strong: Modifiers = { bold: true, italic: false };

/** The width of a bullet item's marker and its space. */
const bulletWidth = 2;
const bulletMarker = String.raw`\(bu`;
const quoteIndent = 4;

/** The space after an ordered marker, which its width counts. */
const markerSpace = 1;

/** The offset past a list's last index, and an index not found. */
const afterLast = 1;
const notFound = -1;

/** The font the modifiers combine to. */
function fontOf({ bold, italic }: Modifiers): Font {
  if (bold && italic) {
    return 'boldItalic';
  }
  if (bold) {
    return 'bold';
  }
  return italic ? 'italic' : 'regular';
}

/** The text runs print without their fonts, which a link compares with its destination. */
function plain(runs: readonly Run[]): string {
  return runs.map((run) => run.text).join('');
}

/**
 * The runs of one line of inline constructs. Emphasis is italic, strong emphasis is bold, and a
 * code span is bold without its backticks; the fonts combine.
 */
function inlineRuns(nodes: readonly Inline[], modifiers: Modifiers): Run[] {
  return nodes.flatMap((node): Run[] => {
    switch (node.kind) {
      case 'text':
      case 'address': {
        return [{ font: fontOf(modifiers), text: node.text }];
      }
      case 'code': {
        return [{ font: fontOf({ bold: true, italic: modifiers.italic }), text: node.content }];
      }
      case 'emphasis': {
        return inlineRuns(node.children, {
          bold: modifiers.bold || node.strong,
          italic: modifiers.italic || !node.strong,
        });
      }
      case 'image':
      case 'link': {
        return linkRuns(node, modifiers);
      }
      default: {
        const exhaustive: never = node;
        return exhaustive;
      }
    }
  });
}

/**
 * A link prints its text, a space, and its destination in angle brackets. When the text prints
 * exactly as the destination, the text alone prints, in its own fonts; when it prints nothing but
 * whitespace, the destination alone prints, so no line starts with the space, which roff reads as a break. An
 * image prints as a link with the same text.
 */
function linkRuns(node: Extract<Inline, { kind: 'link' | 'image' }>, modifiers: Modifiers): Run[] {
  const text = inlineRuns(node.children, modifiers);
  const printed = plain(text);
  const font = fontOf(modifiers);
  if (printed === node.destination) {
    return text;
  }
  if (printed.trim() === '') {
    return [{ font, text: node.destination }];
  }
  return [...text, { font, text: ` <${node.destination}>` }];
}

/** One line of inline constructs as a roff text line. */
function inlineLine(nodes: readonly Inline[], modifiers: Modifiers): string {
  return textLine(writeRuns(inlineRuns(nodes, modifiers)));
}

/**
 * Code lines in no-fill text: the blank lines at its ends dropped, each line without the
 * whitespace at its end, and an empty line written `\&`, so the page holds no blank line.
 */
function codeLines(lines: readonly string[]): string[] {
  const content = lines.map((line) => line.trimEnd());
  const first = content.findIndex((line) => line !== '');
  if (first === notFound) {
    return [];
  }
  let end = content.length;
  while (content[end - afterLast] === '') {
    end -= afterLast;
  }
  return content
    .slice(first, end)
    .map((line) => (line === '' ? String.raw`\&` : textLine(escapeText(line, 'noFill'))));
}

/**
 * The state of one container: the lines it wrote, whether a block precedes the next one, and
 * whether it is the top level of the details, where a heading is an `.SS`.
 */
interface Container {
  readonly lines: string[];
  preceded: boolean;
  readonly topLevel: boolean;
}

/** The `.PP` a block writes when a block precedes it in its container. */
function paragraphBreak(container: Container): string[] {
  return container.preceded ? ['.PP'] : [];
}

/** A block's lines after its `.PP`, or none for a block that prints nothing. */
function opened(container: Container, lines: readonly string[]): string[] {
  return isEmpty(lines) ? [] : [...paragraphBreak(container), ...lines];
}

/** Code lines in no-fill text, or none for code with no other line. */
function wrappedCode(lines: readonly string[]): string[] {
  const code = codeLines(lines);
  return isEmpty(code) ? [] : ['.nf', ...code, '.fi'];
}

/** The lines of blocks inside an `.RS`, where the first block writes no paragraph request. */
function nestedLines(blocks: readonly Block[]): string[] {
  const nested: Container = { lines: [], preceded: false, topLevel: false };
  for (const block of blocks) {
    writeBlock(nested, block);
  }
  return nested.lines;
}

/** Lines indented in `.RS` and `.RE`, or none when there are none to indent. */
function indented(width: number, lines: readonly string[]): string[] {
  return isEmpty(lines) ? [] : [`.RS ${width}`, ...lines, '.RE'];
}

/**
 * One list item: `.IP` with its marker and width, then its blocks. A first paragraph or heading
 * follows the `.IP`, and the later blocks follow in `.PP` and `.RS`; otherwise every block is in
 * `.RS` right after the `.IP`.
 */
function itemLines(item: Item, marker: string, width: number): string[] {
  const opening = `.IP ${marker} ${width}`;
  const [first, ...rest] = item.blocks;
  if (first?.kind !== 'paragraph' && first?.kind !== 'heading') {
    return [opening, ...indented(width, nestedLines(item.blocks))];
  }
  const later = indented(width, nestedLines(rest));
  return [opening, ...leadLines(first), ...(isEmpty(later) ? [] : ['.PP', ...later])];
}

/** The lines of an item's first block when it is a paragraph, or a heading printed in bold. */
function leadLines(block: Extract<Block, { kind: 'paragraph' | 'heading' }>): string[] {
  return block.kind === 'paragraph'
    ? block.lines.map((line) => inlineLine(line, regular))
    : [inlineLine(block.text, strong)];
}

/** A list's items, each marker counting up by one from the first ordered item's number. */
function listLines(block: Extract<Block, { kind: 'list' }>): string[] {
  const { marker } = block;
  return block.items.flatMap((item, index) => {
    if (marker.kind === 'bullet') {
      return itemLines(item, bulletMarker, bulletWidth);
    }
    const label = `${marker.start + index}${marker.delimiter}`;
    return itemLines(item, escapeText(label), label.length + markerSpace);
  });
}

/**
 * The lines one block writes, its `.PP` included, or none for a block that prints nothing. A
 * paragraph, a code block, a quote, a thematic break, and a heading inside a list item or a quote
 * write their `.PP` when a block precedes them; a list item and a top-level heading space
 * themselves.
 */
function blockLines(container: Container, block: Block): string[] {
  switch (block.kind) {
    case 'paragraph': {
      return [...paragraphBreak(container), ...leadLines(block)];
    }
    case 'heading': {
      return container.topLevel
        ? [request('SS', [plain(inlineRuns(block.text, regular))])]
        : [...paragraphBreak(container), ...leadLines(block)];
    }
    case 'code': {
      return opened(container, indented(quoteIndent, wrappedCode(block.lines)));
    }
    case 'break': {
      return [...paragraphBreak(container), textLine(escapeText(block.text))];
    }
    case 'list': {
      return listLines(block);
    }
    case 'quote': {
      return opened(container, indented(quoteIndent, nestedLines(block.blocks)));
    }
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

/** Writes one block into its container; after a top-level heading no block precedes the next. */
function writeBlock(container: Container, block: Block): void {
  const lines = blockLines(container, block);
  if (isEmpty(lines)) {
    return;
  }
  container.lines.push(...lines);
  container.preceded = !(container.topLevel && block.kind === 'heading');
}

/**
 * The roff lines of a Command's details under DESCRIPTION. `preceded` says a paragraph, the
 * deprecation, already opens the section, so the first block writes its `.PP`.
 */
function detailsLines(source: string, { preceded }: { readonly preceded: boolean }): string[] {
  const container: Container = { lines: [], preceded, topLevel: true };
  for (const block of parseMarkdown(source)) {
    writeBlock(container, block);
  }
  return container.lines;
}

export { detailsLines };
