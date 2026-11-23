/*
 * Finds the link targets of a Markdown text: inline links, images, and reference definitions,
 * skipping YAML frontmatter, fenced code, and inline code spans. This module is the one reader of
 * them. `scripts/check-links.mjs` imports it through Node's type stripping, so it holds only
 * erasable TypeScript and imports nothing, and `loom init` rewrites the targets through it, so the
 * link check and the rewrite read the same links.
 */

/** The opening of a fenced code block: its fence and the rest of the line. */
const fenceOpening = /^\s*(?<fence>`{3,}|~{3,})(?<info>.*)$/u;

/** A reference definition: its label and the target that follows, with the target's position. */
const referenceDefinition =
  /^ {0,3}\[(?<label>[^\]]+)\]:[ \t]*(?:<(?<angled>[^>]*)>|(?<bare>\S+))/du;

/** One line of prose: its index among the lines, its text, and the text with code spans blanked. */
interface ProseLine {
  readonly blanked: string;
  readonly index: number;
  readonly raw: string;
}

/** One link target and where it sits: a line index and the column range of the target itself. */
interface TargetSpan {
  readonly end: number;
  readonly index: number;
  readonly start: number;
  readonly target: string;
}

/** Blanks every inline code span in one line, so a link inside it is not read. */
function blankCodeSpans(line: string): string {
  return line.replaceAll(/(?<!`)(?<run>`+)(?!`)(?<body>.*?)(?<!`)\k<run>(?!`)/gu, (span) =>
    ' '.repeat(span.length),
  );
}

/** The lines prose can occupy: frontmatter and fenced code blocks are left out. */
function proseOfLines(lines: readonly string[]): ProseLine[] {
  const prose: ProseLine[] = [];
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.findIndex((line, index) => index > 0 && /^(?:---|\.\.\.)\s*$/u.test(line));
    start = end === -1 ? 0 : end + 1;
  }
  let open = '';
  for (let index = start; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (open === '') {
      const opening = fenceOpening.exec(line)?.groups;
      if (
        opening !== undefined &&
        !(opening.fence?.startsWith('`') && opening.info?.includes('`'))
      ) {
        open = opening.fence ?? '';
      } else {
        prose.push({ blanked: blankCodeSpans(line), index, raw: line });
      }
    } else if (new RegExp(`^\\s*${open[0]}{${open.length},}\\s*$`, 'u').test(line)) {
      open = '';
    }
  }
  return prose;
}

/** Reads an unbracketed destination: a run without spaces whose parentheses balance. */
function bareDestination(rest: string) {
  let depth = 0;
  const first = /^[ \t]*/u.exec(rest)?.[0].length ?? 0;
  let index = first;
  for (; index < rest.length; index += 1) {
    const char = rest[index] ?? '';
    if (char === ')' && depth === 0) {
      break;
    }
    if (/\s/u.test(char)) {
      break;
    }
    depth += (char === '(' ? 1 : 0) - (char === ')' ? 1 : 0);
  }
  return { after: rest.slice(index), start: first, target: rest.slice(first, index) };
}

/**
 * Reads one inline link's destination from the text just after its `](`, and answers the offset of
 * the target in that text and the target, or `undefined` when the text is no link.
 */
function inlineDestination(rest: string): { start: number; target: string } | undefined {
  const angled = /^[ \t]*<(?<target>[^>\n]*)>/u.exec(rest);
  const target = angled?.groups?.target;
  const read =
    angled === null || target === undefined
      ? bareDestination(rest)
      : {
          after: rest.slice(angled[0].length),
          start: angled[0].length - target.length - 1,
          target,
        };
  const closed = /^(?:[ \t\n]+(?:"[^"]*"|'[^']*'|\([^)]*\)))?[ \t\n]*\)/u.test(read.after);
  return closed ? { start: read.start, target: read.target } : undefined;
}

/** The targets of the inline links and images in one paragraph's lines. */
function paragraphTargets(block: readonly ProseLine[]): TargetSpan[] {
  const joined = block.map((entry) => entry.blanked).join('\n');
  const starts: number[] = [];
  let offset = 0;
  for (const entry of block) {
    starts.push(offset);
    offset += entry.blanked.length + 1;
  }
  const spans: TargetSpan[] = [];
  for (const match of joined.matchAll(/\]\(/gu)) {
    const after = match.index + 2;
    const found = joined.slice(0, match.index).includes('[')
      ? inlineDestination(joined.slice(after))
      : undefined;
    const row = starts.findLastIndex((start) => start <= after + (found?.start ?? 0));
    const line = block[row];
    if (found !== undefined && line !== undefined) {
      const start = after + found.start - (starts[row] ?? 0);
      spans.push({
        end: start + found.target.length,
        index: line.index,
        start,
        target: found.target,
      });
    }
  }
  return spans;
}

/** The target of a reference definition line, or `undefined` for any other line. */
function definitionTarget(entry: ProseLine): TargetSpan | undefined {
  const match = referenceDefinition.exec(entry.blanked);
  const label = match?.groups?.label;
  if (match === null || label === undefined || label.startsWith('^')) {
    return undefined;
  }
  const range = match.indices?.groups?.angled ?? match.indices?.groups?.bare;
  const [start, end] = range ?? [0, 0];
  return { end, index: entry.index, start, target: entry.blanked.slice(start, end) };
}

/** Every link target in the lines of one Markdown text, in reading order. */
function targetSpans(lines: readonly string[]): TargetSpan[] {
  const spans: TargetSpan[] = [];
  let block: ProseLine[] = [];
  const flush = () => {
    spans.push(...paragraphTargets(block));
    block = [];
  };
  for (const entry of proseOfLines(lines)) {
    const definition = definitionTarget(entry);
    if (entry.blanked.trim() === '') {
      flush();
    } else if (definition === undefined) {
      block.push(entry);
    } else {
      spans.push(definition);
    }
  }
  flush();
  return spans;
}

/** The lines of a Markdown text that prose can occupy, with the 0-based index of each. */
export function proseLines(text: string): ProseLine[] {
  return proseOfLines(text.split(/\r?\n/u));
}

/**
 * Every link target in one Markdown text, as `{ line, target }` with the 1-based line, in reading
 * order.
 */
export function extractLinks(text: string): { line: number; target: string }[] {
  return targetSpans(text.split(/\r?\n/u))
    .toSorted((left, right) => left.index - right.index || left.start - right.start)
    .map(({ index, target }) => ({ line: index + 1, target }));
}

/**
 * Rewrites each link target of a Markdown text through `rewrite`, which answers the new target, and
 * leaves every other byte as it is, line endings included.
 */
export function rewriteLinkTargets(text: string, rewrite: (target: string) => string): string {
  const crlf = text.includes('\r\n');
  const lines = text.replaceAll('\r\n', '\n').split('\n');
  const spans = targetSpans(lines).toSorted(
    (left, right) => right.index - left.index || right.start - left.start,
  );
  for (const { end, index, start, target } of spans) {
    const line = lines[index] ?? '';
    lines[index] = `${line.slice(0, start)}${rewrite(target)}${line.slice(end)}`;
  }
  return lines.join(crlf ? '\r\n' : '\n');
}

export type { ProseLine };
