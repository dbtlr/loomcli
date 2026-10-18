import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/help-wrap.mjs', import.meta.url);

/** One width a page reads: a terminal that wide, or a pipe. */
type Width = number | null;

interface WrapInput {
  readonly app: Record<string, unknown>;
  readonly columns: Width;
  readonly argv?: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly rendering?: Readonly<Record<string, string>>;
  readonly themed?: boolean;
}

/** What the fixture printed for one page, after it exited cleanly. */
function render(input: WrapInput): string {
  const result = invoke(fixture, [JSON.stringify(input)]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/** The page's blocks, each as its lines. */
function blocks(stdout: string): string[][] {
  return stdout
    .replace(/\n$/u, '')
    .split('\n\n')
    .map((each) => each.split('\n'));
}

/** The block whose first line is `title`. */
function block(stdout: string, title: string): string[] {
  return blocks(stdout).find(([first]) => first === title) ?? [];
}

/** A root with one option whose right cell holds a description, accepted values, and a fact. */
const rows = {
  options: [
    {
      default: 'table',
      description: 'Select the output format.',
      help: { accepts: 'One of: table, json.' },
      name: 'format',
      short: 'o',
      type: 'string',
    },
    {
      default: '8',
      description: 'Set the width of each column.',
      help: { section: ['Layout', 'Columns'] },
      name: 'width',
      short: 'w',
      type: 'string',
    },
    { name: 'quiet', type: 'boolean' },
  ],
};

/** A root with children whose COMMANDS row set needs 2 + 12 + 13 = 27 columns. */
const children = {
  commands: [
    { config: { description: 'Read the configuration values.' }, name: 'alpha' },
    { config: { description: 'Write values.' }, name: 'beta-gamma' },
  ],
  config: { description: 'Read values.' },
};

test('a page at a width it already fits prints as it does off a terminal', () => {
  for (const app of [rows, children]) {
    expect(render({ app, columns: 200 })).toBe(render({ app, columns: null }));
  }
});

test('COLUMNS narrows the page on a terminal and changes nothing on a pipe', () => {
  const app = {
    config: {
      description:
        'Read and reshape one document from a file or a pipe, and print the result in a chosen format.',
    },
  };
  const at = (columns: Width, env?: Record<string, string>) =>
    render({ app, columns, ...(env === undefined ? {} : { env }) });
  expect(at(60)).not.toBe(at(100));
  expect(at(100, { COLUMNS: '60' })).toBe(at(60));
  expect(at(100, { COLUMNS: '150' })).toBe(at(100));
  expect(at(null, { COLUMNS: '60' })).toBe(at(null));
});

test('a right cell wraps as one text under its column, in direct rows and under an inner heading', () => {
  const stdout = render({ app: rows, columns: 40 });
  expect(block(stdout, 'OPTIONS')).toEqual([
    'OPTIONS',
    '  -o, --format <format>  Select the',
    '                         output format.',
    '                         One of: table,',
    '                         json.',
    '                         (default:',
    '                         table)',
    '      --quiet',
    '  -h, --help             Show this help.',
    '  -V, --version          Print the',
    '                         version.',
  ]);
  expect(block(stdout, 'LAYOUT')).toEqual([
    'LAYOUT',
    '  COLUMNS',
    '    -w, --width <width>  Set the width',
    '                         of each column.',
    '                         (default: 8)',
  ]);
});

test('a row set stacks exactly when its indent, left column, and floor exceed the columns', () => {
  expect(block(render({ app: children, columns: 27 }), 'COMMANDS')).toEqual([
    'COMMANDS',
    '  alpha       Read the',
    '              configuration',
    '              values.',
    '  beta-gamma  Write values.',
  ]);
  const stdout = render({ app: children, columns: 26 });
  expect(block(stdout, 'COMMANDS')).toEqual([
    'COMMANDS',
    '  alpha',
    '      Read the',
    '      configuration',
    '      values.',
    '  beta-gamma',
    '      Write values.',
  ]);
  // GLOBAL OPTIONS needs 2 + 15 + 8 = 25 columns, so it keeps two columns.
  expect(block(stdout, 'GLOBAL OPTIONS')).toEqual([
    'GLOBAL OPTIONS',
    '  -h, --help     Show this',
    '                 help.',
    '  -V, --version  Print the',
    '                 version.',
  ]);
});

/** A root with one direct COMMANDS row and one row under the inner heading WRITE. */
function nested(inner: string) {
  return {
    commands: [
      { config: { description: 'Read the configuration values.' }, name: 'alpha' },
      {
        config: { description: 'Write values.' },
        help: { section: ['Commands', 'Write'] },
        name: inner,
      },
    ],
  };
}

test("an outer heading's direct rows and an inner heading's rows stack independently", () => {
  expect(block(render({ app: nested('beta'), columns: 21 }), 'COMMANDS')).toEqual([
    'COMMANDS',
    '  alpha',
    '      Read the',
    '      configuration',
    '      values.',
    '  WRITE',
    '    beta  Write',
    '          values.',
  ]);
  expect(block(render({ app: nested('beta-delta-epsilon'), columns: 30 }), 'COMMANDS')).toEqual([
    'COMMANDS',
    '  alpha  Read the',
    '         configuration values.',
    '  WRITE',
    '    beta-delta-epsilon',
    '        Write values.',
  ]);
});

test('a stacked right cell whose unit is wider than its space overflows on its own line', () => {
  const app = {
    commands: [
      { config: { description: 'See https://example.com/a/very/long/path now.' }, name: 'alpha' },
    ],
  };
  expect(block(render({ app, columns: 20 }), 'COMMANDS')).toEqual([
    'COMMANDS',
    '  alpha',
    '      See',
    '      https://example.com/a/very/long/path',
    '      now.',
  ]);
});

/** A page whose literals are each wider than a narrow terminal. */
const literals = {
  commands: [{ config: { description: 'Go.' }, name: 'go' }],
  help: {
    details: [
      'Use `one two three four five six` here.',
      '',
      'See [docs](https://example.com/a/very/long/path).',
      '',
      '```',
      'const value = compute(input, options);',
      '```',
    ].join('\n'),
    examples: [{ command: 'go --mode fast --level high' }],
  },
  options: [
    { name: 'mode', required: true, type: 'string' },
    { name: 'level', required: true, type: 'string' },
  ],
};

test('usage forms, left cells, code, and example commands print whole on a narrow terminal', () => {
  const lines = render({ app: literals, columns: 15 }).split('\n');
  expect(lines).toContain('  app --mode <mode> --level <level> [options]');
  expect(lines).toContain('      --level <level>');
  expect(lines).toContain('    const value = compute(input, options);');
  expect(lines).toContain('  $ app go --mode fast --level high');
});

test("a Details code span, a hint's command, and a link destination never break", () => {
  const stdout = render({ app: literals, columns: 24 });
  expect(blocks(stdout).slice(1, 3)).toEqual([
    ['  Use', '  `one two three four five six`', '  here.'],
    ['  See docs', '  (https://example.com/a/very/long/path).'],
  ]);
  expect(blocks(render({ app: literals, columns: 15 })).at(-1)).toEqual([
    'Run',
    'app <command> --help',
    'for command',
    'details.',
  ]);
});

/** A page whose Details is the given Markdown. */
function details(markdown: string) {
  return { help: { details: markdown } };
}

/** The Details block of a page, which follows the masthead. */
function detailsAt(markdown: string, columns: Width): string[] {
  return blocks(render({ app: details(markdown), columns }))
    .slice(1, -2)
    .flat();
}

test('a paragraph authored across lines joins and wraps on a terminal, and keeps its lines off one', () => {
  const markdown = 'The first line of text\nand the second line\nand the third.';
  expect(detailsAt(markdown, 40)).toEqual([
    '  The first line of text and the second',
    '  line and the third.',
  ]);
  expect(detailsAt(markdown, 200)).toEqual([
    '  The first line of text and the second line and the third.',
  ]);
  expect(detailsAt(markdown, null)).toEqual([
    '  The first line of text',
    '  and the second line',
    '  and the third.',
  ]);
});

test('a list item continues after its marker, nested two levels, and a quote carries its marker', () => {
  const markdown = [
    '- A first item whose text runs long enough to wrap.',
    '  - A nested item whose text also runs long enough.',
    '',
    '> A quoted line of text that runs long enough to wrap.',
  ].join('\n');
  expect(detailsAt(markdown, 30)).toEqual([
    '  - A first item whose text',
    '    runs long enough to wrap.',
    '    - A nested item whose text',
    '      also runs long enough.',
    '  > A quoted line of text that',
    '  > runs long enough to wrap.',
  ]);
});

test('a heading wraps and code keeps every line as written', () => {
  const markdown = [
    '# A heading that is long enough to wrap',
    '',
    '```',
    'first code line that is longer than thirty',
    'second',
    '```',
  ].join('\n');
  expect(detailsAt(markdown, 30)).toEqual([
    '  A heading that is long',
    '  enough to wrap',
    '    first code line that is longer than thirty',
    '    second',
  ]);
});

test('an emphasis pair on one authored line stays styled after the join', () => {
  const stdout = render({
    app: details('Some *emphasis* here\nand more.'),
    columns: 200,
    rendering: { color: 'never', modifiers: 'always' },
  });
  expect(blocks(stdout)[1]).toEqual(['  Some \u001b[3memphasis\u001b[23m here and more.']);
});

/** A root with a long description, a deprecated child, and an example with a long note. */
const hanging = {
  commands: [
    {
      config: {
        deprecated: 'Use the new command, which reads every format this one did.',
        description: 'Read.',
      },
      name: 'old',
    },
  ],
  config: {
    description: 'Read and reshape one document from a file or a pipe.',
    version: 'v1.2.3',
  },
  help: {
    examples: [{ command: 'old', note: 'Reads the document from the named file and prints it.' }],
  },
  postfix: '(Report schema v1 of the long format name here)',
};

test('at 40 columns each prose text continues where its first line started', () => {
  const root = render({ app: hanging, columns: 40 });
  expect(blocks(root)[0]).toEqual([
    'app · Read and reshape one document from',
    '      a file or a pipe.',
  ]);
  expect(block(root, 'EXAMPLES')).toEqual([
    'EXAMPLES',
    '  $ app old',
    '    Reads the document from the named',
    '    file and prints it.',
  ]);
  expect(blocks(root).at(-1)).toEqual(['Run app <command> --help for command', 'details.']);
  expect(blocks(render({ app: hanging, argv: ['old', '--help'], columns: 40 }))[0]).toEqual([
    'app old · Read.',
    '  Deprecated: Use the new command, which',
    '              reads every format this',
    '              one did.',
  ]);
});

test('the version line stays one line on a narrow terminal', () => {
  expect(render({ app: hanging, argv: ['--version'], columns: 20 })).toBe(
    'app v1.2.3 (Report schema v1 of the long format name here)\n',
  );
});

test('a text with less than one column left for it prints unwrapped', () => {
  const app = { config: { description: 'Read values from somewhere.' }, name: 'application' };
  expect(blocks(render({ app, columns: 14 }))[0]).toEqual([
    'application · Read values from somewhere.',
  ]);
  expect(block(render({ app: children, columns: 6 }), 'COMMANDS')).toEqual([
    'COMMANDS',
    '  alpha',
    '      Read the configuration values.',
    '  beta-gamma',
    '      Write values.',
  ]);
});

test('a tab in a description, a Details paragraph, and a code line expands on a terminal alone', () => {
  const app = {
    help: { details: 'A\tB\n\n```\nx\ty\n```' },
    options: [{ description: 'Name\tthe value.', name: 'name', type: 'string' }],
  };
  const terminal = render({ app, columns: 80 });
  expect(terminal).not.toContain('\t');
  expect(blocks(terminal).slice(1, 3)).toEqual([['  A       B'], ['    x       y']]);
  expect(block(terminal, 'OPTIONS')[1]).toBe('      --name <name>  Name    the value.');
  const piped = render({ app, columns: null });
  expect(blocks(piped).slice(1, 3)).toEqual([['  A\tB'], ['    x\ty']]);
  expect(block(piped, 'OPTIONS')[1]).toBe('      --name <name>  Name\tthe value.');
});

/** Color and modifiers on, under the Loom theme. */
const themed = { rendering: { color: 'always', modifiers: 'always' }, themed: true } as const;

test('a wrapped right cell closes its styles before the indent and opens them after it', () => {
  const app = {
    commands: [{ config: { deprecated: 'Use read.', description: 'Read one.' }, name: 'get' }],
  };
  expect(block(render({ app, columns: 22, ...themed }), '\u001b[90mCOMMANDS\u001b[39m')).toEqual([
    '\u001b[90mCOMMANDS\u001b[39m',
    '  \u001b[33mget\u001b[39m  Read one.',
    '       \u001b[90m(\u001b[93mdeprecated:\u001b[39m',
    '       \u001b[93mUse read.\u001b[90m)\u001b[39m',
  ]);
});

test('a wrapped deprecation message and a stacked row keep their styles on every line', () => {
  const app = {
    commands: [
      {
        config: { deprecated: 'Use the new command instead.', description: 'Read one.' },
        name: 'old',
      },
    ],
  };
  const stdout = render({ app, argv: ['old', '--help'], columns: 30, ...themed });
  expect(blocks(stdout)[0]).toEqual([
    '\u001b[33;1mapp old\u001b[39;22m \u001b[90m·\u001b[39m Read one.',
    '  \u001b[93mDeprecated: Use the new\u001b[39m',
    '              \u001b[93mcommand instead.\u001b[39m',
  ]);
  const root = render({ app, columns: 18, ...themed });
  expect(block(root, '\u001b[90mCOMMANDS\u001b[39m')).toEqual([
    '\u001b[90mCOMMANDS\u001b[39m',
    '  \u001b[33mold\u001b[39m',
    '      Read one.',
    '      \u001b[90m(\u001b[93mdeprecated:\u001b[39m',
    '      \u001b[93mUse the new\u001b[39m',
    '      \u001b[93mcommand\u001b[39m',
    '      \u001b[93minstead.\u001b[90m)\u001b[39m',
  ]);
});
