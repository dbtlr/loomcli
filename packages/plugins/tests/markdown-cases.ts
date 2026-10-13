/** Inputs and independently authored page lines from the Markdown Details contract. */
const blockCases: [name: string, source: string, lines: string[]][] = [
  [
    'backtick fences ignore an info string and Markdown, and accept a longer close',
    '  ```ts\n  **literal**\n    indented\n  ````\nAfter.',
    ['    **literal**', '      indented', '  After.'],
  ],
  [
    'tilde fences and an unclosed fence run to the container end',
    '~~~ language\n*literal*\n~~~\n```\n# literal',
    ['    *literal*', '    # literal'],
  ],
  ['a later backtick prevents a backtick fence', '```bad`info\nnext', ['  ```bad`info', '  next']],
  [
    'indented code starts after a blank, but indentation continues a paragraph',
    'before\n    continuation\n\n    **code**\n\n        deep\n\nafter',
    ['  before', '  continuation', '', '    **code**', '', '        deep', '', '  after'],
  ],
  [
    'headings strip closing runs but preserve C# and seven markers',
    '# one ###\n###### six\n# C#\n####### seven\n#',
    ['  one', '  six', '  C#', '  ####### seven'],
  ],
  [
    'quotes contain lists and code and end on an unmarked line',
    '> paragraph\n> - one\n>   ```\n>   **code**\n>   ```\n>\n> last\noutside',
    ['  > paragraph', '  > - one', '  >     **code**', '  >', '  > last', '  outside'],
  ],
  [
    'thematic breaks win over lists and lose indentation',
    'intro\n  ---\n* * *\n___\nend',
    ['  intro', '  ---', '  * * *', '  ___', '  end'],
  ],
  [
    'bullet lists nest two levels, keep lazy lines and authored separators',
    'intro\n- parent\n  - child\n    - grandchild\n      continued\n\n- next\nlazy\n+ another',
    [
      '  intro',
      '  - parent',
      '    - child',
      '      - grandchild',
      '        continued',
      '',
      '  - next',
      '    lazy',
      '  - another',
    ],
  ],
  [
    'ordered lists count from three and preserve delimiters',
    '3. first\n9. second\n   continued\n\n007) seven\n1) eight\n   later',
    ['  3. first', '  4. second', '     continued', '', '  7) seven', '  8) eight', '     later'],
  ],
  [
    'ordered lists nest two levels and renumber each list independently',
    '3. parent\n   007) child\n        1. grandchild\n9. next',
    ['  3. parent', '     7) child', '        1. grandchild', '  4. next'],
  ],
  [
    'five marker spaces open code and empty marker lines take their next content',
    '-     code\n-\n  next\n  line',
    ['  -   code', '  - next', '    line'],
  ],
  [
    'lists can start directly under a paragraph',
    'Intro\n- first\n- second',
    ['  Intro', '  - first', '  - second'],
  ],
  [
    'every marker block interrupts a paragraph without extra blanks',
    'a\n```\ncode\n```\nb\n# h\nc\n> q\nd\n---\ne\n1. item',
    ['  a', '    code', '  b', '  h', '  c', '  > q', '  d', '  ---', '  e', '  1. item'],
  ],
  [
    'unsupported tables, setext underlines, references, HTML and entities stay text',
    'a | b\n--- | ---\nTitle\n===\n[ref]: https://example.org\n<div>\n&amp;\n</div>',
    [
      '  a | b',
      '  --- | ---',
      '  Title',
      '  ===',
      '  [ref]: https://example.org',
      '  <div>',
      '  &amp;',
      '  </div>',
    ],
  ],
  [
    'terminators and surrounding whitespace normalize without wrapping',
    ' \r\n  first  \rsecond\u0085third\u2028fourth\vfive\fsix\u2029seven\n\n ',
    ['  first', '  second', '  third', '  fourth', '  five', '  six', '  seven'],
  ],
  [
    'tabs expand in leading indentation and after list and quote markers',
    '\tcode\n\n-\titem\n\tcontinued\n>\tquote',
    ['    code', '', '  - item', '    continued', '  > quote'],
  ],
  [
    'blank lines collapse between blocks but stay inside code',
    '\n\nfirst\n\n\nsecond\n```\n\ncode  \n\n\nlast\n\n```\n\n',
    ['  first', '', '  second', '    code', '', '', '    last'],
  ],
  [
    'plain multiline Details keeps exact bytes',
    'first line\nsecond line\nthird line',
    ['  first line', '  second line', '  third line'],
  ],
];

const inlineCases: [name: string, source: string, line: string][] = [
  [
    'both emphasis characters and strong emphasis nest',
    '*one* _two_ **three** __four__ **bold _nested_**',
    'one two three four bold nested',
  ],
  ['crossing runs leave intervening opening markers literal', '*a _b* c_', 'a _b c_'],
  [
    'unmatched runs, runs of three and underscores in words are literal',
    '*open **open ___three___ snake_case_name',
    '*open **open ___three___ snake_case_name',
  ],
  ['strong closes inside a word', '**pre**fix', 'prefix'],
  [
    'one and two backtick spans keep their contents and delimiters',
    '`*literal*` ``a`b`` `C:\\` `open',
    '`*literal*` ``a`b`` `C:\\` `open',
  ],
  [
    'escapes protect punctuation and leave letters alone',
    '\\*literal\\* \\`no code \\q',
    '*literal* `no code \\q',
  ],
  [
    'links and images print text and a destination',
    '[text](url) ![image](image.png)',
    'text (url) image (image.png)',
  ],
  ['emphasis outside links and inline syntax in text', '*[**text**](url)*', 'text (url)'],
  [
    'link text balances brackets and destinations balance parentheses',
    '[a [b]](https://example.org/a(b))',
    'a [b] (https://example.org/a(b))',
  ],
  ['code and escaped brackets do not close link text', '[a \\] `]`](url)', 'a ] `]` (url)'],
  [
    'a code span ending in an escaped backslash leaves the closing bracket balanced',
    String.raw`[C:\\](url)`,
    String.raw`C:\ (url)`,
  ],
  [
    'equal text prints the address once',
    '[https://example.org](https://example.org)',
    'https://example.org',
  ],
  [
    'whitespace destinations and unmatched brackets stay literal',
    '[text](bad url) [unclosed',
    '[text](bad url) [unclosed',
  ],
  [
    'autolinks recognize all prefixes and preserve other angle brackets',
    '<http://a> <https://b> <mailto:a@b> <host:port>',
    'http://a https://b mailto:a@b <host:port>',
  ],
  ['HTML and entities remain literal', '<b>x</b> &amp;', '<b>x</b> &amp;'],
];

export { blockCases, inlineCases };
