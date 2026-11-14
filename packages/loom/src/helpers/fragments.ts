import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { escapeControlCharacters } from '@loomcli/core';
import { fromMarkdown } from 'mdast-util-from-markdown';

import { withoutByteOrderMark } from './byte-order-mark.js';
import { conventionalFragments } from './conventions.js';
import { requireClosedBlocks } from './markdown.js';
import { readDirectory, readRegularFileBytes } from './repository.js';
import type { Checkout } from './repository.js';

// Undefined for a name outside the grammar: a bare kind prefix, an empty slug, or another extension.
function fragmentKind(name: string): FragmentKind | undefined {
  if (!name.endsWith('.md') || name === '.md') {
    return undefined;
  }
  const stem = name.slice(0, -'.md'.length);
  for (const kind of ['breaking', 'feature'] satisfies FragmentKind[]) {
    if (stem === kind) {
      return undefined;
    }
    if (stem.startsWith(`${kind}.`)) {
      return stem.length > kind.length + 1 ? kind : undefined;
    }
  }
  return 'fix';
}

const lineFeed = 0x0a;

/**
 * Characters core escapes in a quoted diagnostic that a fragment keeps: tab and line feed shape
 * Markdown, and the line and paragraph separators are text.
 */
const keptEscapes = new Set([
  '\t',
  '\n',
  String.fromCodePoint(0x20_28),
  String.fromCodePoint(0x20_29),
]);

/** The zero-width space, which core leaves unescaped and a fragment refuses as invisible. */
const zeroWidthSpace = String.fromCodePoint(0x20_0b);

function codePointName(character: string) {
  const codePoint = character.codePointAt(0) ?? 0;
  return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`;
}

/** The kind of file a character refusal names: each is prose `write` copies into the changelog. */
type ProseSource = 'fragment' | 'narrative';

/**
 * The sentence for a character a fragment or a narrative refuses, or undefined for one it keeps.
 * Both refuse what core's `escapeControlCharacters` escapes, except tab, line feed, and the line
 * and paragraph separators, and also the zero-width space, so `write` never copies a terminal
 * control, a carriage return, or an invisible reordering into the changelog. The sentence names
 * the character by its code point and never prints it.
 */
function unsafeCharacter(character: string, source: ProseSource) {
  const escaped = escapeControlCharacters(character) !== character;
  if (character !== zeroWidthSpace && (!escaped || keptEscapes.has(character))) {
    return undefined;
  }
  const name = codePointName(character);
  if (character === '\r') {
    return `holds the carriage return ${name}. Save the ${source} with LF line endings.`;
  }
  if (/\p{Cc}/u.test(character)) {
    return `holds the control character ${name}. Remove it, because a ${source} accepts no control character but tab and line feed.`;
  }
  return `holds the invisible format character ${name}. Remove it.`;
}

// A fatal decoder throws on bytes that are not UTF-8.
// Each call decodes one whole line, so the decoder keeps no state between calls.
const strictDecoder = new TextDecoder('utf-8', { fatal: true });

// One line's text, or undefined when its bytes are not valid UTF-8.
function decodedLine(bytes: Uint8Array) {
  try {
    return strictDecoder.decode(bytes);
  } catch {
    return undefined;
  }
}

// Refuses one line whose bytes are not UTF-8 or hold a character `unsafeCharacter` refuses.
function requireSafeLine(path: string, line: number, bytes: Buffer, source: ProseSource) {
  const text = decodedLine(bytes);
  if (text === undefined) {
    throw new Error(
      `${path}: line ${String(line)} is not valid UTF-8. Save the ${source} as UTF-8.`,
    );
  }
  for (const character of text) {
    const sentence = unsafeCharacter(character, source);
    if (sentence !== undefined) {
      throw new Error(`${path}: line ${String(line)} ${sentence}`);
    }
  }
}

/** The one-based lines of a file that a character scan covers, both ends included. */
interface ScannedLines {
  readonly first: number;
  readonly last: number;
}

const everyLine: ScannedLines = { first: 1, last: Number.POSITIVE_INFINITY };

function validateBody(path: string, kind: FragmentKind, body: string) {
  requireClosedBlocks(body, path);
  const nodes = fromMarkdown(body).children;
  const migrationIndex = nodes.findIndex((node) => node.type === 'heading');
  const breaking = kind === 'breaking';
  const bullets = breaking && migrationIndex !== -1 ? nodes.slice(0, migrationIndex) : nodes;
  if (
    bullets.length === 0 ||
    bullets.some(
      (node) =>
        node.type !== 'list' ||
        node.ordered ||
        node.children.some((item) => item.children.length === 0),
    )
  ) {
    throw new Error(`${path}: expected top-level change bullets.`);
  }
  if (!breaking) {
    return;
  }
  const heading = nodes[migrationIndex];
  if (
    heading?.type !== 'heading' ||
    heading.depth !== 3 ||
    heading.children.length !== 1 ||
    heading.children[0]?.type !== 'text' ||
    heading.children[0].value !== 'Migration'
  ) {
    throw new Error(`${path}: expected one ### Migration section after the bullets.`);
  }
  const migrationNodes = nodes.slice(migrationIndex + 1);
  if (migrationNodes.some((node) => node.type === 'heading')) {
    throw new Error(`${path}: expected one ### Migration section.`);
  }
  const labels = ['Affected surface.', 'Why.', 'Before and after.', 'Steps.', 'Validation.'];
  const found = migrationNodes.flatMap((node) => {
    const first = node.type === 'paragraph' ? node.children[0] : undefined;
    if (
      first?.type !== 'strong' ||
      first.children.length !== 1 ||
      first.children[0]?.type !== 'text'
    ) {
      return [];
    }
    return labels.includes(first.children[0].value) ? [first.children[0].value] : [];
  });
  if (labels.some((label) => found.filter((item) => item === label).length !== 1)) {
    throw new Error(`${path}: Migration requires each label once: ${labels.join(', ')}`);
  }
}

// One fragment, read and validated. An invalid entry throws the sentence that names it.
async function readFragment(
  checkout: Checkout,
  entry: Awaited<ReturnType<typeof readDirectory>>[number],
  ref: string | undefined,
  folder: string,
) {
  const { name } = entry;
  const path = `${folder}/${name}`;
  if (!entry.isFile()) {
    throw new Error(`${path}: expected a fragment file. Keep fragments directly in ${folder}/.`);
  }
  const kind = fragmentKind(name);
  if (kind === undefined) {
    throw new Error(`${path}: expected <slug>.md, feature.<slug>.md, or breaking.<slug>.md.`);
  }
  const bytes = await readRegularFileBytes(checkout, path, ref);
  requireSafeCharacters(path, bytes, 'fragment');
  const source = bytes.toString('utf8');
  const body = withoutByteOrderMark(source);
  validateBody(path, kind, body);
  return { body, kind, name, source };
}

/** A fragment's kind, read from its file name: `breaking.<slug>.md`, `feature.<slug>.md`, or `<slug>.md`. */
export type FragmentKind = 'breaking' | 'feature' | 'fix';

/**
 * Every fragment in the folder under the root, read from the working tree or from a revision. The
 * folder is relative to the root, with `/` between its segments, and may leave it. The regular file
 * `README.md` is the guide, not a fragment. A hidden entry, one whose name starts with `.`, is
 * ignored, and a missing working-tree folder holds no fragments. One error names every invalid
 * entry, so a single run reports them all.
 */
export async function readFragments(
  checkout: Checkout,
  ref?: string,
  folder = conventionalFragments,
) {
  if (ref === undefined && !existsSync(join(checkout.root, folder))) {
    return [];
  }
  const failures: string[] = [];
  const fragments = [];
  const listed = await readDirectory(checkout, folder, ref);
  const entries = listed
    .filter((entry) => !entry.name.startsWith('.'))
    .filter((entry) => entry.name !== 'README.md' || !entry.isFile());
  for (const entry of entries) {
    try {
      fragments.push(await readFragment(checkout, entry, ref, folder));
    } catch (error) {
      // A cancelled run reads no further fragment and reports none.
      checkout.signal.throwIfAborted();
      failures.push(error instanceof Error ? error.message : String(error));
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  return fragments;
}

/**
 * Refuses a fragment or a narrative whose bytes are not UTF-8 or hold a character
 * `unsafeCharacter` refuses, naming the path and the line of the first one. A line feed byte never
 * occurs inside a UTF-8 sequence, so each line decodes alone. The scan covers every line, or only
 * the given lines of a file that holds a narrative among other text, numbered within the file.
 */
export function requireSafeCharacters(
  path: string,
  bytes: Buffer,
  source: ProseSource,
  lines = everyLine,
) {
  let start = 0;
  for (let line = 1; start <= bytes.length && line <= lines.last; line += 1) {
    const found = bytes.indexOf(lineFeed, start);
    const end = found === -1 ? bytes.length : found;
    if (line >= lines.first) {
      requireSafeLine(path, line, bytes.subarray(start, end), source);
    }
    start = end + 1;
  }
}
