import { graphemeWidths } from '@rockorager/uucode/width';

import type { TextUnit, Unit } from './style-ansi.js';
import type { Attributes } from './style-state.js';
import type { Padding } from './style-wire.js';

/** Width at each tab-stop offset composes without rescanning nested text. */
interface Metrics {
  advance: readonly number[];
  tabs: boolean;
  text: boolean;
}
type Rope = (
  | { kind: 'leaf'; unit: TextUnit; tab: boolean }
  | { kind: 'join'; children: readonly Rope[] }
) &
  Metrics;
interface Line {
  content: Rope;
  ending: readonly TextUnit[];
}
interface Block {
  lines: readonly Line[];
  minimum: number;
  tabs: boolean;
}
const offsets = [0, 1, 2, 3, 4, 5, 6, 7];
const empty: Rope = {
  advance: offsets.map(() => 0),
  children: [],
  kind: 'join',
  tabs: false,
  text: false,
};

function leaf(unit: TextUnit, width: number, tab = false): Rope {
  return {
    advance: offsets.map((offset) => (tab ? 8 - offset : width)),
    kind: 'leaf',
    tab,
    tabs: tab,
    text: unit.kind === 'text' && unit.text.length > 0,
    unit,
  };
}
function join(children: readonly Rope[]): Rope {
  children = children.filter((child) => child !== empty);
  if (children.length === 0) {
    return empty;
  }
  if (children.length === 1 && children[0]) {
    return children[0];
  }
  const advance = offsets.map(
    (offset) =>
      children.reduce((column, child) => column + (child.advance[column % 8] ?? 0), offset) -
      offset,
  );
  return {
    advance,
    children,
    kind: 'join',
    tabs: children.some((child) => child.tabs),
    text: children.some((child) => child.text),
  };
}
function* leaves(root: Rope): Generator<Extract<Rope, { kind: 'leaf' }>> {
  const stack: { node: Rope; index: number }[] = [{ index: 0, node: root }];
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (!frame) {
      break;
    }
    if (frame.node.kind === 'leaf') {
      yield frame.node;
      stack.pop();
      continue;
    }
    const child = frame.node.children[frame.index];
    if (child === undefined) {
      stack.pop();
      continue;
    }
    frame.index += 1;
    stack.push({ index: 0, node: child });
  }
}

/** Grapheme segmentation ignores attribute boundaries and terminal-control envelopes. */
function textBlock(units: readonly TextUnit[]): Block {
  const visible = units
    .filter((unit) => unit.kind === 'text')
    .map((unit) => unit.text)
    .join('');
  const widths = new Map<number, number>();
  for (const segment of graphemeWidths(visible)) {
    widths.set(segment.start, segment.width);
  }
  const lines: Line[] = [];
  let parts: Rope[] = [];
  let offset = 0;
  for (const unit of units) {
    if (unit.kind !== 'text') {
      parts.push(leaf(unit, 0));
      continue;
    }
    if (unit.text === '\n' || unit.text === '\r\n') {
      lines.push({ content: join(parts), ending: [unit] });
      parts = [];
    } else {
      let width = 0;
      for (let at = offset; at < offset + unit.text.length; at += 1) {
        width += widths.get(at) ?? 0;
      }
      parts.push(leaf(unit, width, unit.text === '\t'));
    }
    offset += unit.text.length;
  }
  lines.push({ content: join(parts), ending: [] });
  return measured(lines);
}
function measured(lines: readonly Line[]): Block {
  let minimum = Infinity;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line && !(index > 0 && index === lines.length - 1 && !line.content.text)) {
      minimum = Math.min(minimum, line.content.advance[0] ?? 0);
    }
  }
  return { lines, minimum, tabs: lines.some((line) => line.content.tabs) };
}
function expandTabs(root: Rope): Rope {
  if (!root.tabs) {
    return root;
  }
  const parts: Rope[] = [];
  let column = 0;
  for (const part of leaves(root)) {
    const width = part.advance[column % 8] ?? 0;
    parts.push(part.tab ? leaf({ ...part.unit, text: ' '.repeat(width) }, width) : part);
    column += width;
  }
  return join(parts);
}
function padBlock(block: Block, padding: Padding, attributes: Attributes): Block {
  if (!block.tabs && block.minimum >= padding.width) {
    return block;
  }
  const lines = block.lines.map((line, index) => {
    // A terminal newline has no extra line to align; interior blank lines do.
    if (index > 0 && index === block.lines.length - 1 && !line.content.text) {
      return line;
    }
    const content = expandTabs(line.content);
    const missing = Math.max(0, padding.width - (content.advance[0] ?? 0));
    if (missing === 0) {
      return content === line.content ? line : { ...line, content };
    }
    let before = 0;
    if (padding.align === 'right') {
      before = missing;
    } else if (padding.align === 'center') {
      before = Math.floor(missing / 2);
    }
    const space = (count: number) =>
      leaf({ attributes, kind: 'text', text: ' '.repeat(count) }, count);
    // Re-segment inserted spaces too: a trailing Unicode Prepend character can absorb one.
    const spaced = join([space(before), content, space(missing - before)]);
    const row = measured([{ content: spaced, ending: [] }]);
    let padded = textBlock([...renderedUnits(row)]);
    const shortfall = padding.width - padded.minimum;
    if (shortfall > 0) {
      padded = textBlock([
        ...renderedUnits(padded),
        { attributes, kind: 'text', text: ' '.repeat(shortfall) },
      ]);
    }
    return { ...line, content: padded.lines[0]?.content ?? empty };
  });
  return measured(lines);
}
/** A deferred concatenation preserves shared output and caches complete Unicode analysis. */
interface TextRope {
  parts: readonly (TextRope | TextUnit)[];
  tabs: boolean;
  analysis?: Block;
}
function textRope(parts: readonly (TextRope | TextUnit)[]): TextRope {
  if (parts.length === 1 && parts[0] && 'parts' in parts[0]) {
    return parts[0];
  }
  return {
    parts,
    tabs: parts.some((part) =>
      'parts' in part ? part.tabs : part.kind === 'text' && part.text.includes('\t'),
    ),
  };
}
function* textUnits(root: TextRope): Generator<TextUnit> {
  const stack: { rope: TextRope; index: number }[] = [{ index: 0, rope: root }];
  while (stack.length > 0) {
    const frame = stack.at(-1);
    if (!frame) {
      break;
    }
    // Analysis is owned by the composed root; old subtree snapshots need not stay live.
    if (frame.rope !== root) {
      delete frame.rope.analysis;
    }
    const part = frame.rope.parts[frame.index++];
    if (!part) {
      stack.pop();
    } else if ('parts' in part) {
      stack.push({ index: 0, rope: part });
    } else {
      yield part;
    }
  }
}
function analyze(rope: TextRope): Block {
  rope.analysis ??= textBlock([...textUnits(rope)]);
  return rope.analysis;
}
interface Pending {
  parts: (TextRope | TextUnit)[];
  padding: { value: Padding; attributes: Attributes } | undefined;
}

/** Nested padding resolves inside outward; unchanged content retains its rope and analysis. */
function layout(units: readonly Unit[]): Block {
  let current: Pending = { padding: undefined, parts: [] };
  const stack: Pending[] = [];
  for (const unit of units) {
    if (unit.kind === 'open') {
      stack.push(current);
      current = { padding: { attributes: unit.attributes, value: unit.padding }, parts: [] };
    } else if (unit.kind === 'close') {
      let rope = textRope(current.parts);
      const padding = current.padding;
      if (padding && (padding.value.width > 0 || rope.tabs)) {
        const original = analyze(rope);
        const padded = padBlock(original, padding.value, padding.attributes);
        if (padded !== original) {
          rope = { analysis: padded, parts: [...renderedUnits(padded)], tabs: false };
        }
      }
      current = stack.pop() ?? { padding: undefined, parts: [] };
      current.parts.push(rope);
    } else {
      current.parts.push(unit);
    }
  }
  return analyze(textRope(current.parts));
}
function* renderedUnits(block: Block): Generator<TextUnit> {
  for (const line of block.lines) {
    for (const part of leaves(line.content)) {
      yield part.unit;
    }
    yield* line.ending;
  }
}
function blockWidth(block: Block): number {
  return block.lines.reduce((widest, line) => Math.max(widest, line.content.advance[0] ?? 0), 0);
}

export { blockWidth, layout, renderedUnits };
