import { breaks } from '../lines.js';
import { parseInline } from './inline.js';
import type { Inline } from './inline.js';

const firstElement = 0;
const lastElementOffset = -1;
const indexIncrement = 1;
const emptyLength = 0;
const minimumHeadingLevel = 1;
const markerPadding = 1;
const quoteMarkerWidth = 1;

type BlockContent =
  | { readonly kind: 'paragraph'; readonly lines: readonly (readonly Inline[])[] }
  | { readonly kind: 'heading'; readonly level: number; readonly text: readonly Inline[] }
  | { readonly kind: 'code'; readonly lines: readonly string[] }
  | { readonly kind: 'break'; readonly text: string }
  | { readonly kind: 'quote'; readonly blocks: readonly Block[] }
  | { readonly kind: 'list'; readonly marker: ListMarker; readonly items: readonly Item[] };
/** Containers and leaves share the author's separator, independently of any projection. */
type Block = BlockContent & { readonly blankBefore: boolean };
interface Parsed {
  block: BlockContent;
  index: number;
}
interface Item {
  readonly blankBefore: boolean;
  readonly blocks: readonly Block[];
}
type ListMarker =
  | { readonly kind: 'bullet'; readonly character: string }
  | { readonly kind: 'ordered'; readonly delimiter: string; readonly start: number };
const codeIndent = 4;
const tabStop = 4;
const maxMarkerIndent = 3;

/** Tabs in container prefixes use source columns; tabs in authored text stay literal. */
function expandedWhitespace(prefix: string, whitespace: string): string {
  let expanded = prefix;
  for (const character of whitespace) {
    expanded += character === '\t' ? ' '.repeat(tabStop - (expanded.length % tabStop)) : character;
  }
  return expanded;
}

/** Expands only whitespace before text and between container markers. */
function expandTabs(line: string): string {
  const state = { index: firstElement, prefix: '' };
  while (state.index < line.length) {
    const marker = containerPrefix(line, state);
    if (marker === undefined) {
      return state.prefix + line.slice(state.index);
    }
    state.prefix += marker;
    state.index += marker.length;
  }
  return state.prefix;
}

/** Tracks absolute columns through consecutive quote and list marker prefixes. */
function containerPrefix(
  line: string,
  state: { index: number; prefix: string },
): string | undefined {
  const whitespace = /^[ \t]+/u.exec(line.slice(state.index))?.[firstElement] ?? '';
  state.prefix = expandedWhitespace(state.prefix, whitespace);
  state.index += whitespace.length;
  return /^(?:>|[-+*](?=[ \t]|$)|[0-9]{1,9}[.)](?=[ \t]|$))/u.exec(line.slice(state.index))?.[
    firstElement
  ];
}

/** The column of a line's first character that is not a space; `$` matches a line of spaces alone. */
function indentation(line: string): number {
  return line.search(/[^ ]|$/u);
}

function blank(line: string): boolean {
  return !/\S/u.test(line);
}

/** Only up to three spaces precede a block marker after its container's indentation. */
function markerText(line: string): string | undefined {
  return indentation(line) <= maxMarkerIndent ? line.trimStart() : undefined;
}

function fence(line: string) {
  const text = markerText(line);
  const run = text === undefined ? undefined : /^(?:`{3,}|~{3,})/u.exec(text)?.[firstElement];
  if (run === undefined || (run.startsWith('`') && text?.slice(run.length).includes('`'))) {
    return undefined;
  }
  return { character: run[firstElement] ?? '', indent: indentation(line), length: run.length };
}

function heading(line: string) {
  const text = markerText(line);
  const match =
    text === undefined ? undefined : /^(?<marker>#{1,6})(?=\s|$)(?<text>.*)$/u.exec(text);
  return !match
    ? undefined
    : {
        level: match.groups?.marker?.length ?? minimumHeadingLevel,
        text: (match.groups?.text ?? '').replace(/\s+#+\s*$/u, '').trim(),
      };
}

function quote(line: string): string | undefined {
  const text = markerText(line);
  return text?.startsWith('>') ? text.slice(quoteMarkerWidth).replace(/^ /u, '') : undefined;
}

function thematic(line: string): boolean {
  const text = markerText(line);
  return (
    text !== undefined &&
    /^(?:-(?:[ \t]*-){2,}|\*(?:[ \t]*\*){2,}|_(?:[ \t]*_){2,})[ \t]*$/u.test(text)
  );
}

/** A marker carries both its source content column and its list's identity. */
function listItem(line: string) {
  const text = markerText(line);
  const match =
    text === undefined ? undefined : /^(?<marker>[-+*]|[0-9]{1,9}[.)])(?: +|$)/u.exec(text);
  if (!match || thematic(line)) {
    return undefined;
  }
  const spelling = match.groups?.marker ?? '';
  const whitespace = match[firstElement].length - spelling.length;
  const empty = blank(text?.slice(spelling.length) ?? '');
  const padding = empty || whitespace > codeIndent ? markerPadding : whitespace;
  const column = indentation(line) + spelling.length + padding;
  return { column, content: empty ? '' : line.slice(column), marker: listMarker(spelling) };
}

/** List identity is the bullet character or the ordered delimiter, independently of numbering. */
function listMarker(spelling: string): ListMarker {
  return /^[-+*]$/u.test(spelling)
    ? { character: spelling, kind: 'bullet' }
    : {
        delimiter: spelling.slice(lastElementOffset),
        kind: 'ordered',
        start: Number(spelling.slice(firstElement, lastElementOffset)),
      };
}

/** All supported marker blocks interrupt a paragraph; indented code alone does not. */
function interrupts(line: string): boolean {
  return (
    fence(line) !== undefined ||
    heading(line) !== undefined ||
    quote(line) !== undefined ||
    thematic(line) ||
    listItem(line) !== undefined
  );
}

/** A closing fence holds only a matching run and whitespace. */
function closesFence(line: string, opening: NonNullable<ReturnType<typeof fence>>): boolean {
  const text = markerText(line);
  const closing =
    text === undefined ? undefined : /^(?:`+|~+)\s*$/u.exec(text)?.[firstElement].trimEnd();
  return (
    closing !== undefined &&
    closing.startsWith(opening.character) &&
    closing.length >= opening.length
  );
}

/** Fences consume only their current container and remove at most the opening indentation. */
function fenced(
  lines: readonly string[],
  start: number,
  opening: NonNullable<ReturnType<typeof fence>>,
) {
  const content: string[] = [];
  let index = start + indexIncrement;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    if (closesFence(line, opening)) {
      return { index: index + indexIncrement, lines: content };
    }
    const remove = Math.min(indentation(line), opening.indent);
    content.push(line.slice(remove));
    index += indexIncrement;
  }
  return { index, lines: content };
}

/** Indented code keeps interior empty lines; trailing blanks belong to the following block. */
function indented(lines: readonly string[], start: number) {
  const content: string[] = [];
  for (let index = start; index < lines.length; index += indexIncrement) {
    const line = lines[index] ?? '';
    if (!blank(line) && indentation(line) < codeIndent) {
      break;
    }
    content.push(line.slice(codeIndent));
  }
  while (
    content.at(lastElementOffset) !== undefined &&
    blank(content.at(lastElementOffset) ?? '')
  ) {
    content.pop();
  }
  return { index: start + content.length, lines: content };
}

type ParagraphBlock =
  | { kind: 'closed' | 'paragraph' | 'indented' }
  | { kind: 'fence'; opening: NonNullable<ReturnType<typeof fence>> }
  | { kind: 'list'; column: number; item: ParagraphState };
interface ParagraphState {
  blank: boolean;
  block: ParagraphBlock;
  open: boolean;
}

/** Tracks only the active block and the final visible paragraph, without parsing accumulated lines. */
function paragraphState(content = ''): ParagraphState {
  const state: ParagraphState = { blank: false, block: { kind: 'closed' }, open: false };
  if (content !== '') {
    trackParagraph(state, content);
  }
  return state;
}

/** A lazy line belongs only to an open paragraph, never across a blank or an interrupting marker. */
function lazy(state: ParagraphState, line: string): boolean {
  return state.open && !state.blank && !interrupts(line);
}

/** Nested items use the same indentation and lazy rules as the item's actual container collector. */
function continueList(
  block: Extract<ParagraphBlock, { kind: 'list' }>,
  line: string,
  separated: boolean,
): boolean {
  if (indentation(line) >= block.column) {
    if (separated) {
      trackParagraph(block.item, '');
    }
    trackParagraph(block.item, line.slice(block.column));
    return true;
  }
  if (!separated && lazy(block.item, line)) {
    trackParagraph(block.item, line.trim());
    return true;
  }
  return false;
}

/** A continued nested item supplies the final visible paragraph of its containing list. */
function continueNested(
  state: ParagraphState,
  line: string,
  { block, separated }: { block: Extract<ParagraphBlock, { kind: 'list' }>; separated: boolean },
): boolean {
  const continued = continueList(block, line, separated);
  if (continued) {
    state.open = block.item.open;
  }
  return continued;
}

/** Only the matching closing run ends an active fence. */
function continueFence(
  state: ParagraphState,
  line: string,
  opening: NonNullable<ReturnType<typeof fence>>,
): boolean {
  if (closesFence(line, opening)) {
    state.block = { kind: 'closed' };
  }
  return true;
}

/** Opaque code stays closed to lazy text; a nested list inherits its innermost item's paragraph. */
function continueBlock(state: ParagraphState, line: string, separated: boolean): boolean {
  const { block } = state;
  switch (block.kind) {
    case 'fence': {
      return continueFence(state, line, block.opening);
    }
    case 'list': {
      return continueNested(state, line, { block, separated });
    }
    case 'paragraph': {
      return !separated && !interrupts(line);
    }
    case 'indented': {
      return indentation(line) >= codeIndent;
    }
    case 'closed': {
      return false;
    }
    default: {
      const exhaustive: never = block;
      return exhaustive;
    }
  }
}

/** An empty heading closes the active block but leaves the last visible block's paragraph state. */
function startBlock(state: ParagraphState, line: string): void {
  const opening = fence(line);
  if (opening !== undefined) {
    state.block = { kind: 'fence', opening };
    state.open = false;
    return;
  }
  const title = heading(line);
  if (title === undefined) {
    startContainer(state, line);
  } else {
    state.block = { kind: 'closed' };
    state.open = title.text === '' && state.open;
  }
}

/** Quotes and thematic breaks cannot end in a lazy paragraph; list content can. */
function startContainer(state: ParagraphState, line: string): void {
  if (quote(line) !== undefined || thematic(line)) {
    state.block = { kind: 'closed' };
    state.open = false;
    return;
  }
  const opening = listItem(line);
  if (opening !== undefined) {
    startList(state, opening);
    return;
  }
  state.open = indentation(line) < codeIndent;
  state.block = { kind: state.open ? 'paragraph' : 'indented' };
}

/** A new item's content column and paragraph state replace the previous item's tail. */
function startList(state: ParagraphState, opening: NonNullable<ReturnType<typeof listItem>>): void {
  const item = paragraphState(opening.content);
  state.block = { column: opening.column, item, kind: 'list' };
  state.open = item.open;
}

/** Blank separators are deferred until a following line proves they belong to a nested item. */
function trackParagraph(state: ParagraphState, line: string): void {
  if (blank(line)) {
    state.blank = true;
    return;
  }
  const separated = state.blank;
  state.blank = false;
  if (!continueBlock(state, line, separated)) {
    startBlock(state, line);
  }
}

/** Collects one item's container, leaving separators for the list or its following block. */
function itemLines(
  lines: readonly string[],
  start: number,
  opening: NonNullable<ReturnType<typeof listItem>>,
) {
  const content = opening.content === '' ? [] : [opening.content];
  const paragraph = paragraphState(opening.content);
  let index = start + indexIncrement;
  let next = itemContinuation(lines, index, { column: opening.column, paragraph });
  while (next !== undefined) {
    content.push(next.text);
    trackParagraph(paragraph, next.text);
    index = next.index;
    next = itemContinuation(lines, index, { column: opening.column, paragraph });
  }
  return { index, lines: content };
}

/** Locates the next nonblank line, leaving the authoring separator visible to its caller. */
function nonblank(lines: readonly string[], start: number): number {
  let index = start;
  while (index < lines.length && blank(lines[index] ?? '')) {
    index += indexIncrement;
  }
  return index;
}

/** Indentation admits any block; an unindented line must continue the item's open paragraph. */
function itemContinuation(
  lines: readonly string[],
  index: number,
  { column, paragraph }: { column: number; paragraph: ParagraphState },
) {
  const candidate = nonblank(lines, index);
  const line = lines[candidate];
  if (line === undefined) {
    return undefined;
  }
  if (candidate > index) {
    return indentation(line) >= column ? { index: index + indexIncrement, text: '' } : undefined;
  }
  if (indentation(line) >= column) {
    return { index: index + indexIncrement, text: line.slice(column) };
  }
  return lazy(paragraph, line) ? { index: index + indexIncrement, text: line.trim() } : undefined;
}

function sameList(left: ListMarker, right: ListMarker): boolean {
  if (left.kind === 'bullet') {
    return right.kind === 'bullet' && left.character === right.character;
  }
  return right.kind === 'ordered' && left.delimiter === right.delimiter;
}

/** Consecutive compatible items share numbering even when the author separates them. */
function list(
  lines: readonly string[],
  start: number,
  opening: NonNullable<ReturnType<typeof listItem>>,
) {
  const items: Item[] = [];
  let next: ReturnType<typeof followingItem> = {
    blankBefore: false,
    index: start,
    marker: opening,
  };
  let index = start;
  while (next !== undefined) {
    const content = itemLines(lines, next.index, next.marker);
    items.push({ blankBefore: next.blankBefore, blocks: parseBlocks(content.lines) });
    index = content.index;
    next = followingItem(lines, index, opening.marker);
  }
  return { index, items };
}

/** A separator keeps its authored blank only when another compatible item follows. */
function followingItem(lines: readonly string[], start: number, identity: ListMarker) {
  const index = nonblank(lines, start);
  const marker = listItem(lines[index] ?? '');
  return marker !== undefined && sameList(identity, marker.marker)
    ? { blankBefore: index > start, index, marker }
    : undefined;
}

/** Reads code before all other markers, without interpreting its authored contents. */
function codeBlock(lines: readonly string[], start: number): Parsed | undefined {
  const line = lines[start] ?? '';
  const opening = fence(line);
  const content = opening === undefined ? undefined : fenced(lines, start, opening);
  const code = content ?? (indentation(line) >= codeIndent ? indented(lines, start) : undefined);
  return code === undefined
    ? undefined
    : { block: { kind: 'code', lines: code.lines }, index: code.index };
}

function headingBlock(lines: readonly string[], start: number): Parsed | undefined {
  const title = heading(lines[start] ?? '');
  return title === undefined
    ? undefined
    : {
        block: { kind: 'heading', level: title.level, text: parseInline(title.text) },
        index: start + indexIncrement,
      };
}

/** Every quote line must carry its own marker; an unmarked line ends its container. */
function quoteBlock(lines: readonly string[], start: number): Parsed | undefined {
  const content: string[] = [];
  let index = start;
  let next = quote(lines[index] ?? '');
  while (index < lines.length && next !== undefined) {
    content.push(next);
    index += indexIncrement;
    next = quote(lines[index] ?? '');
  }
  return content.length === emptyLength
    ? undefined
    : { block: { blocks: parseBlocks(content), kind: 'quote' }, index };
}

function breakBlock(lines: readonly string[], start: number): Parsed | undefined {
  const line = lines[start] ?? '';
  return thematic(line)
    ? { block: { kind: 'break', text: line.trim() }, index: start + indexIncrement }
    : undefined;
}

function listBlock(lines: readonly string[], start: number): Parsed | undefined {
  const item = listItem(lines[start] ?? '');
  if (item === undefined) {
    return undefined;
  }
  const content = list(lines, start, item);
  return {
    block: { items: content.items, kind: 'list', marker: item.marker },
    index: content.index,
  };
}

/** Paragraphs preserve each authored line and end at a blank or a supported marker. */
function paragraphBlock(lines: readonly string[], start: number): Parsed {
  const content = [parseInline((lines[start] ?? '').trim())];
  let index = start + indexIncrement;
  while (index < lines.length && !blank(lines[index] ?? '') && !interrupts(lines[index] ?? '')) {
    content.push(parseInline((lines[index] ?? '').trim()));
    index += indexIncrement;
  }
  return { block: { kind: 'paragraph', lines: content }, index };
}

/** Marker precedence is shared by every nested container. */
function blockAt(lines: readonly string[], start: number): Parsed {
  return (
    codeBlock(lines, start) ??
    headingBlock(lines, start) ??
    quoteBlock(lines, start) ??
    breakBlock(lines, start) ??
    listBlock(lines, start) ??
    paragraphBlock(lines, start)
  );
}

/** Parses a container's already normalized lines without help styles or host state. */
function parseBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = [];
  let index = firstElement;
  while (index < lines.length) {
    const start = nonblank(lines, index);
    if (start >= lines.length) {
      break;
    }
    const parsed = blockAt(lines, start);
    blocks.push({ blankBefore: start > index, ...parsed.block });
    index = parsed.index;
  }
  return withoutEmptyHeadings(blocks);
}

/** An empty heading is no block, but never erases a blank line authored before it. */
function withoutEmptyHeadings(blocks: readonly Block[]): Block[] {
  const result: Block[] = [];
  let blankBefore = false;
  for (const block of blocks) {
    blankBefore ||= block.blankBefore;
    if (block.kind !== 'heading' || block.text.length > emptyLength) {
      result.push({ ...block, blankBefore });
      blankBefore = false;
    }
  }
  return result;
}

/** Normalizes the pack's line terminators and source-column tabs before parsing containers. */
function parseMarkdown(source: string): Block[] {
  return parseBlocks(source.split(breaks).map(expandTabs));
}

export { parseMarkdown };
export type { Block, Item };
