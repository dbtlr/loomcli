/*
 * Acceptance plan for Markdown details (docs/plugins/help-page.md#markdown-details).
 *
 * Markdown details are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Example page. jsonkit's `get` reads its help `details` from `src/commands/get.md` through a
 *   text import, and `jsonkit get --help` prints the page above, byte for byte, with color and
 *   modifiers disabled, from the `loom build --target node` bundle the example tests run. `jsonkit
 *   get -h` omits the block and prints the pointer. `jsonkit get --manifest` carries the file's
 *   text as written, final line terminator included. Every other example page and manifest is
 *   unchanged.
 * - Packed consumer. `check:packed` bundles a fixture entry whose details come from a text import
 *   of a `.md` file with the packed `loom build --target node`, as it bundles its release fixture,
 *   and the bundle's `--help` page prints the rendered block under Node and Bun. The `tsc`-compiled
 *   consumer keeps inline details.
 * - Blocks. Fixtures cover each block rule: fenced code with backticks and with tildes, an info
 *   string ignored, a backtick run with a later backtick on its line, a longer closing run, an
 *   unclosed fence running to the end of its container, and Markdown inside code printing as
 *   written; indented code after a blank line, and a line indented four spaces that continues a
 *   paragraph reading as paragraph text; headings at levels one and six, with the level 1 underline
 *   as wide as its widest wrapped line and none at level six, a closing `#` run removed, `# C#`
 *   keeping its `#`, seven `#` printing as text, and `#` alone printing nothing; a quote holding a
 *   list and code, and ending at a line without `>`; thematic breaks `---`, `* * *`, and `___`;
 *   bullet and ordered lists, nested two levels, with and without blank lines between items, an
 *   ordered list starting at `3` and at `007`, `)` delimiters printing `.`, an ordered list of ten
 *   items right-aligning ` 9.` under `10.`, an ordered list under a bullet, a change of bullet
 *   character starting a new list, a lazy continuation line, an item whose content starts after
 *   more than four spaces, an item whose marker line holds nothing else, and a list directly under
 *   a paragraph; and a paragraph interrupted by each block that can interrupt it.
 * - Inline. Fixtures cover each inline rule: emphasis and strong emphasis with both characters,
 *   nested, crossing, unmatched, closing inside a word as in `prefix`, and spanning a line break;
 *   `snake_case_name`; a run of three; code spans with one and two backticks, holding emphasis
 *   markers, ending in a backslash, and unclosed; backslash escapes of a marker, a backtick, and a
 *   letter; a link, an image, a link inside emphasis, a link whose text holds brackets, a
 *   destination holding balanced parentheses, a link whose text equals its destination, a
 *   destination holding whitespace, and a bracket that starts no link; and autolinks with each of
 *   the three prefixes beside `<host:port>`, which prints as written.
 * - Unsupported constructs. A table, a setext underline, a reference definition, an HTML block, and
 *   an entity read under the paragraph and inline rules.
 * - Lines. CRLF, CR, NEL, and LINE SEPARATOR read as line breaks; a tab in leading indentation and
 *   a tab after a list marker expand to the next multiple of four columns; whitespace at both ends
 *   and a final terminator are accepted; details of whitespace alone is a declaration fault at the
 *   call on `helpCommand` and on `manifestCommand`; details that renders no line prints no block,
 *   and the compact page prints no pointer for it when the Command has no examples; and no page
 *   line ends in whitespace.
 * - Compatibility. jsonkit's root and textstat's root, whose details use no Markdown syntax, print
 *   their pages unchanged, and so does a multi-line details value with no Markdown syntax and no
 *   whitespace at either end of a line.
 * - Styles and escaping. Exact themed bytes pin each style above: a plain paragraph line as one
 *   `primary` value, a heading, nested emphasis, a code span inside a heading and inside strong
 *   emphasis, a link inside emphasis with its destination, a link and an autolink that print an
 *   address alone, and the list and quote markers. Style-wire marker characters inside a heading, a
 *   code span, a code line, and a link destination print literally. With modifiers disabled,
 *   emphasis and headings carry no escape.
 */

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { blockCases, inlineCases } from './markdown-cases.js';

/** Runs Markdown through the shipped help view, with an independent expected block. */
function run(details: string, options: Record<string, unknown> = {}) {
  return invoke(new URL('fixtures/markdown-help.mjs', import.meta.url), [
    JSON.stringify({ details, ...options }),
  ]);
}

/** The complete plain page around Details, authored from the contract. */
function page(lines: string[]) {
  return {
    status: 0,
    stderr: '',
    stdout: [
      'app',
      '',
      ...lines,
      ...(lines.length === 0 ? [] : ['']),
      'USAGE',
      '  app [options]',
      '',
      'OPTIONS',
      '  -h, --help      Show this help.',
      "      --manifest  Print this command's manifest as JSON.",
      '',
    ].join('\n'),
  };
}

test('Details renders authored paragraphs, headings, lists, code, and links', () => {
  expect(
    run(
      'Intro.\n\n# Title\n- A **key**: `a.b`.\n- See [format](https://example.org).\n\n```ts\n**literal**\n```',
    ),
  ).toEqual(
    page([
      '  Intro.',
      '',
      '  Title',
      '  ─────',
      '  ● A key: `a.b`.',
      '  ● See format (https://example.org).',
      '',
      '    **literal**',
    ]),
  );
});

test.each(blockCases)('built Markdown blocks: %s', (_name, source, lines) => {
  expect(run(source)).toEqual(page(lines));
});

test.each(inlineCases)('built Markdown inline: %s', (_name, source, line) => {
  expect(run(source)).toEqual(page([`  ${line}`]));
});

test('the manifest retains Markdown source bytes including its final terminator', () => {
  expect(run('# Heading\n\n- item\n', { inspect: true })).toEqual({
    status: 0,
    stderr: '',
    stdout: '[{"details":"# Heading\\n\\n- item\\n"}]\n',
  });
});
