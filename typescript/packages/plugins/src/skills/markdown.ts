/*
 * How a command reference writes text as CommonMark: a value Loom shows is one line, escaped so it
 * renders as written and stays readable as raw text; a label is a code span; and Markdown the
 * author wrote is inserted as written, its line breaks LF and its blank edge lines left out.
 */
import { allBreaks, singleLine } from '../lines.js';

/**
 * Each character a shown value escapes: `\`, a backtick, `*`, `[`, and `<` always; an `_` without
 * an ASCII letter or digit on both sides, which under CommonMark's flanking rule is the only `_`
 * that can open or close emphasis; and an `&` that an ASCII letter or `#` follows, which could
 * start an entity or a character reference.
 */
const markup = /[\\`*[<]|(?<![\dA-Za-z])_|_(?![\dA-Za-z])|&(?=[#A-Za-z])/gu;

/** A paragraph's opening that CommonMark reads as a block: a heading, a quote, or a list item. */
const blockStart = /^[#>+-]/u;

/** A paragraph's opening run of three or more `~`, which CommonMark reads as a code fence. */
const fenceStart = /^~{3,}/u;

/** A paragraph's opening run of digits and the `.` or `)` that would make it an ordered list. */
const orderedStart = /^(?<digits>\d+)(?<marker>[.)])/u;

/** Spaces and tabs, which a shown value and a blank line are trimmed of. */
const edgeBlanks = /^[\t ]+|[\t ]+$/gu;

/**
 * A value Loom shows, as one line of escaped text: each line break a space, the spaces and tabs at
 * either end left out, and a backslash before each character CommonMark would read as markup. At
 * the start of a paragraph a leading block marker, a leading run of three or more `~`, or the `.`
 * or `)` after leading digits, takes a backslash too.
 */
function shownText(text: string, { paragraph }: { readonly paragraph: boolean }): string {
  const escaped = singleLine(text)
    .replaceAll(edgeBlanks, '')
    .replaceAll(markup, String.raw`\$&`);
  return paragraph
    ? escaped
        .replace(blockStart, String.raw`\$&`)
        .replace(fenceStart, String.raw`\$&`)
        .replace(orderedStart, String.raw`$<digits>\$<marker>`)
    : escaped;
}

/** The longest run of backticks a text holds. */
function longestBackticks(text: string): number {
  let longest = 0;
  for (const run of text.match(/`+/gu) ?? []) {
    longest = Math.max(longest, run.length);
  }
  return longest;
}

/**
 * A code span, its content written as it is: one backtick on each side, or one more than the
 * content's longest run of backticks, with a space inside each delimiter when the content begins
 * or ends with a backtick.
 */
function codeSpan(content: string): string {
  const delimiter = `${'`'.repeat(longestBackticks(content))}\``;
  const padding = content.startsWith('`') || content.endsWith('`') ? ' ' : '';
  return `${delimiter}${padding}${content}${padding}${delimiter}`;
}

/** The blank lines a text opens with, each empty or spaces and tabs alone. */
const openingBlanks = /^(?:[\t ]*\n)+/u;

/** The blank lines a text closes with, each empty or spaces and tabs alone. */
const closingBlanks = /(?:\n[\t ]*)+$/u;

/**
 * Markdown the author wrote, as written, with each line break written as LF and the blank lines
 * before its first line that is not blank and after its last one left out. Every line between
 * them keeps its indentation and its trailing spaces.
 */
function authoredMarkdown(source: string): string {
  return source.replaceAll(allBreaks, '\n').replace(openingBlanks, '').replace(closingBlanks, '');
}

export { authoredMarkdown, codeSpan, shownText };
