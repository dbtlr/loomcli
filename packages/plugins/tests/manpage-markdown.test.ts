import { expect, test } from 'vite-plus/test';

import { detailsLines } from '../src/manpage/markdown.js';

/** The roff lines one Markdown source renders to, as DESCRIPTION opens with it. */
function roff(...source: string[]): string[] {
  return detailsLines(source.join('\n'), { preceded: false });
}

const bullet = String.raw`.IP \(bu 2`;

test.each<[string, string[], string[]]>([
  ['a paragraph keeps its lines as source lines, which man fills', ['one', 'two'], ['one', 'two']],
  ['a paragraph after another opens with .PP', ['one', '', 'two'], ['one', '.PP', 'two']],
  [
    'table rows read as the paragraph text they follow and lead, which man fills',
    ['intro', '| a | b |', '| c | d |', 'after', '', '| e |', '', '- item', '  | f |'],
    ['intro', '| a | b |', '| c | d |', 'after', '.PP', '| e |', bullet, 'item', '| f |'],
  ],
  [
    'a line indented four spaces directly after table rows is paragraph text, which man fills',
    ['Para.', '| a | b |', '    indented line after rows'],
    ['Para.', '| a | b |', 'indented line after rows'],
  ],
  [
    'a line indented four spaces directly after table rows that open details is paragraph text',
    ['| a | b |', '    indented line after rows'],
    ['| a | b |', 'indented line after rows'],
  ],
  [
    'a line indented four spaces past an item directly after its table rows is paragraph text',
    ['- item', '  | a | b |', '      deeper line'],
    [bullet, 'item', '| a | b |', 'deeper line'],
  ],
  [
    'a heading at the top level is .SS with its inline constructs as plain text, and opens no .PP after it',
    ['intro', '', '# Read `x` *now* [here](https://x.org)', '', 'text'],
    ['intro', '.SS "Read x now here <https://x.org>"', 'text'],
  ],
  [
    'a heading inside a list item is a paragraph in bold',
    ['- # Title *now*', '', '  text'],
    [bullet, String.raw`\fBTitle \fR\f(BInow\fR`, '.PP', '.RS 2', 'text', '.RE'],
  ],
  [
    'fenced code drops blank lines at its ends, keeps an empty line, and trims each line end',
    ['before', '', '```', '', '  code  ', '', String.raw`a\b`, '', '```'],
    ['before', '.PP', '.RS 4', '.nf', '  code', String.raw`\&`, String.raw`a\eb`, '.fi', '.RE'],
  ],
  [
    'indented code first in details opens no .PP',
    ['    one', '    .two', '', 'after'],
    ['.RS 4', '.nf', 'one', String.raw`\&.two`, '.fi', '.RE', '.PP', 'after'],
  ],
  ['code with no other line prints nothing', ['```', '', '```', 'after'], ['after']],
  [
    'a thematic break is a paragraph that holds it as written',
    ['a', '', '---', '', 'b'],
    ['a', '.PP', String.raw`\-\-\-`, '.PP', 'b'],
  ],
  [
    'nested bullet lists indent by the parent marker, and an ordered list counts from its first number',
    ['- parent', '  - child', '- next', '', '007. seven', '008. eight', '010) ten'],
    [
      bullet,
      'parent',
      '.PP',
      '.RS 2',
      bullet,
      'child',
      '.RE',
      bullet,
      'next',
      '.IP 7. 3',
      'seven',
      '.IP 8. 3',
      'eight',
      '.IP 10) 4',
      'ten',
    ],
  ],
  [
    'an ordered list nests in a bullet item',
    ['- parent', '  1. one', '  2. two'],
    [bullet, 'parent', '.PP', '.RS 2', '.IP 1. 3', 'one', '.IP 2. 3', 'two', '.RE'],
  ],
  [
    'an item whose first block is code holds every block in .RS right after .IP',
    ['- ```', '  code', '  ```', '  after'],
    [bullet, '.RS 2', '.RS 4', '.nf', 'code', '.fi', '.RE', '.PP', 'after', '.RE'],
  ],
  [
    'a quote holding a list indents it, with no paragraph request before the first item',
    ['> - one', '> - two'],
    ['.RS 4', bullet, 'one', bullet, 'two', '.RE'],
  ],
  [
    'a quote after a paragraph writes its .PP before the .RS',
    ['text', '', '> quoted', '> more'],
    ['text', '.PP', '.RS 4', 'quoted', 'more', '.RE'],
  ],
  [
    'an item with two paragraphs holds the second in .PP and .RS',
    ['- first', '', '  second'],
    [bullet, 'first', '.PP', '.RS 2', 'second', '.RE'],
  ],
  [
    'a paragraph after a list opens with .PP',
    ['- one', '', 'after'],
    [bullet, 'one', '.PP', 'after'],
  ],
])('%s', (_name, source, lines) => {
  expect(roff(...source)).toEqual(lines);
});

test.each<[string, string, string]>([
  ['emphasis is italic', 'an *open* door', String.raw`an \fIopen\fR door`],
  ['strong emphasis is bold', 'a **bold** step', String.raw`a \fBbold\fR step`],
  [
    'a code span is bold without its backticks',
    'run `ls -l` now',
    String.raw`run \fBls \-l\fR now`,
  ],
  [
    'a code span inside emphasis is bold italic',
    '*read `x` here*',
    String.raw`\fIread \fR\f(BIx\fR\fI here\fR`,
  ],
  [
    'a link prints its text and its destination in angle brackets',
    'see [the format](https://www.json.org/json-en.html).',
    String.raw`see the format <https://www.json.org/json\-en.html>.`,
  ],
  [
    'a link whose text is its destination prints the destination alone',
    'see [https://x.org](https://x.org)',
    'see https://x.org',
  ],
  [
    'a link whose text is its destination keeps the fonts of its text',
    'see [**https://x.org**](https://x.org) and [`x`](x)',
    String.raw`see \fBhttps://x.org\fR and \fBx\fR`,
  ],
  [
    'an image whose text prints empty prints its destination alone, with no space before it',
    '![](logo.png) after',
    'logo.png after',
  ],
  ['a link whose text prints empty prints its destination alone', 'see [](x.org)', 'see x.org'],
  [
    'a link whose text prints only whitespace prints its destination alone, with no space before it',
    '[ ](x.org) after',
    'x.org after',
  ],
  [
    'an image prints as a link with the same text',
    '![the logo](https://x.org/logo.png)',
    'the logo <https://x.org/logo.png>',
  ],
  ['an autolink prints its address', 'mail <mailto:me@x.org>', 'mail mailto:me@x.org'],
  ['a backslash escape prints its character', String.raw`\*not emphasis\*`, '*not emphasis*'],
])('%s', (_name, source, line) => {
  expect(roff(source)).toEqual([line]);
});

test('details after a deprecation paragraph open with .PP', () => {
  expect(detailsLines('text', { preceded: true })).toEqual(['.PP', 'text']);
  expect(detailsLines('- item', { preceded: true })).toEqual([bullet, 'item']);
  expect(detailsLines('# Heading', { preceded: true })).toEqual(['.SS "Heading"']);
});

test('a tab in a paragraph is a space and one in code is kept', () => {
  expect(roff('a\tb', '', '```', 'c\td', '```')).toEqual([
    'a b',
    '.PP',
    '.RS 4',
    '.nf',
    'c\td',
    '.fi',
    '.RE',
  ]);
});
