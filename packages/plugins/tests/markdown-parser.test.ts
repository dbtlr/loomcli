import { Writable } from 'node:stream';

import { Application, readExtension, style } from '@loomcli/core';
import type { RenderingPolicy } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { helpCommand } from '@loomcli/plugins/help/extension';
import { manifestCommand } from '@loomcli/plugins/manifest/extension';
import { theme } from '@loomcli/plugins/theme';
import { expect, test } from 'vite-plus/test';

import { parseMarkdown } from '../src/markdown/blocks.js';
import { blockCases, inlineCases } from './markdown-cases.js';

/** Captures the shipped view through public APIs without starting a process. */
async function render(
  details: string,
  {
    argv = ['--help'],
    themed = false,
    modifiers = 'never',
  }: { argv?: string[]; themed?: boolean; modifiers?: RenderingPolicy['modifiers'] } = {},
) {
  let stdout = '';
  let stderr = '';
  const errors = new Writable({
    write(chunk: Buffer, _encoding, done) {
      stderr += chunk.toString();
      done();
    },
  });
  const output = new Writable({
    write(chunk: Buffer, _encoding, done) {
      stdout += chunk.toString();
      done();
    },
  });
  const plugins = [
    help(),
    ...(themed ? [theme({ dim: style.magenta, highlight: style.cyan, primary: style.green })] : []),
  ];
  const app = new Application('app', { plugins }).extend(helpCommand({ details })).action(() => {});
  const status = await app.run({
    host: { argv, env: {}, release: { build: 'distributed' }, stderr: errors, stdout: output },
    rendering: { color: themed ? 'always' : 'never', modifiers },
  });
  expect({ status, stderr }).toEqual({ status: 0, stderr: '' });
  return stdout;
}

/** The complete page around the independently authored Details lines. */
function page(lines: string[]) {
  return [
    'app',
    '',
    ...lines,
    ...(lines.length > 0 ? [''] : []),
    'USAGE',
    '  app [options]',
    '',
    'OPTIONS',
    '  -h, --help  Show this help.',
    '',
  ].join('\n');
}

test.each(blockCases)('Markdown blocks: %s', async (_name, source, lines) => {
  await expect(render(source)).resolves.toBe(page(lines));
});

test.each(inlineCases)('Markdown inline: %s', async (_name, source, line) => {
  await expect(render(source)).resolves.toBe(page([`  ${line}`]));
});

test('inline constructs never span authored lines', async () => {
  await expect(render('*first\nsecond*\n`first\nsecond`\n[text\n](url)')).resolves.toBe(
    page(['  *first', '  second*', '  `first', '  second`', '  [text', '  ](url)']),
  );
});

test.each(['#', '```\n```', '~~~\n\n~~~'])(
  'empty Markdown %j omits Details and the compact pointer',
  async (source) => {
    await expect(render(source)).resolves.toBe(page([]));
    await expect(render(source, { argv: ['-h'] })).resolves.toBe(page([]));
  },
);

test('compact help omits rendered Markdown and points to extended help', async () => {
  await expect(render('# Heading\n- item', { argv: ['-h'] })).resolves.toBe(
    `${page([])}\nRun app --help for details and examples.\n`,
  );
});

test('the parser records authored separators on nested and top-level blocks', () => {
  expect(parseMarkdown('one\n\n# two\n- item\n\n  next')).toMatchObject([
    { blankBefore: false, kind: 'paragraph' },
    { blankBefore: true, kind: 'heading' },
    {
      blankBefore: false,
      items: [
        {
          blocks: [
            { blankBefore: false, kind: 'paragraph' },
            { blankBefore: true, kind: 'paragraph' },
          ],
        },
      ],
      kind: 'list',
    },
  ]);
});

test('help supplies the exact Markdown source, including its final terminator', () => {
  const source = '  # Heading\r\n\r\n- **item**\n';
  const app = new Application('app', { plugins: [help()] })
    .extend(helpCommand({ details: source }))
    .action(() => {});
  expect(readExtension(app.inspect().root, manifestCommand)).toEqual([{ details: source }]);
});

test.each(['', ' \t\n\r\u2028'])(
  'whitespace-only Details %j faults at both declaration calls',
  (details) => {
    expect(() => new Application('app').extend(helpCommand({ details }))).toThrow(
      'Supply Markdown that holds a character other than whitespace.',
    );
    expect(() => new Application('app').extend(manifestCommand({ details }))).toThrow(
      'Supply Markdown that holds a character other than whitespace.',
    );
  },
);

/** The custom theme styles the rest of the page around a hand-written ANSI Details block. */
function themedPage(lines: string[], modifiers = true) {
  return [
    modifiers ? '\u001b[36;1mapp\u001b[39;22m' : '\u001b[36mapp\u001b[39m',
    '',
    ...lines,
    '',
    '\u001b[35mUSAGE\u001b[39m',
    modifiers
      ? '  \u001b[36mapp\u001b[39m \u001b[35;3m[options]\u001b[39;23m'
      : '  \u001b[36mapp\u001b[39m \u001b[35m[options]\u001b[39m',
    '',
    '\u001b[35mOPTIONS\u001b[39m',
    '  \u001b[36m-h\u001b[35m,\u001b[39m \u001b[36m--help\u001b[39m  \u001b[32mShow this help.\u001b[39m',
    '',
  ].join('\n');
}

test('themed bytes pin blocks, nested modifiers, code, destinations, addresses and markers', async () => {
  await expect(
    render(
      'Plain line.\n# Heading `code`\n**bold _nested_**\n**`code`**\n*[link](url)*\n[url](url) <https://a>\n- item\n> quote\n---\n```\n  code\n```',
      { modifiers: 'always', themed: true },
    ),
  ).resolves.toBe(
    themedPage([
      '  \u001b[32mPlain line.\u001b[39m',
      '  \u001b[32;1mHeading \u001b[36m`code`\u001b[39;22m',
      '  \u001b[32;1mbold \u001b[3mnested\u001b[39;22;23m',
      '  \u001b[36;1m`code`\u001b[39;22m',
      '  \u001b[32;3mlink\u001b[39m \u001b[35m(url)\u001b[39;23m',
      '  \u001b[32murl https://a\u001b[39m',
      '  \u001b[35m-\u001b[39m \u001b[32mitem\u001b[39m',
      '  \u001b[35m>\u001b[39m \u001b[32mquote\u001b[39m',
      '  \u001b[32m---\u001b[39m',
      '    \u001b[36m  code\u001b[39m',
    ]),
  );
});

test('marker characters in headings, spans, code and destinations print literally', async () => {
  await expect(
    render(
      '# Heading \uE001red\uE002\n`\uE003`\n```\n\uE001code\uE002\n```\n[text](\uE001url\uE002)',
      { modifiers: 'always', themed: true },
    ),
  ).resolves.toBe(
    themedPage([
      '  \u001b[32;1mHeading \uE001red\uE002\u001b[39;22m',
      '  \u001b[36m`\uE003`\u001b[39m',
      '    \u001b[36m\uE001code\uE002\u001b[39m',
      '  \u001b[32mtext\u001b[39m \u001b[35m(\uE001url\uE002)\u001b[39m',
    ]),
  );
});

test('disabled modifiers add no escapes for emphasis or headings', async () => {
  await expect(render('# Heading\n**bold** _italic_', { themed: true })).resolves.toBe(
    themedPage(['  \u001b[32mHeading\u001b[39m', '  \u001b[32mbold italic\u001b[39m'], false),
  );
  await expect(render('# Heading\n**bold** _italic_')).resolves.toBe(
    page(['  Heading', '  bold italic']),
  );
});

test('a plain paragraph stays one primary marked value, including its spaces', async () => {
  // Adjacent primary fragments would resolve to the same ANSI bytes; inspect the view's wire too.
  const { renderDetails } = await import('../src/help/details.js');
  const { createStyle } = await import('../../core/dist/style.js');
  const contextual = createStyle();
  expect(renderDetails('One plain line.', { style: contextual, width: () => 0 })).toEqual([
    '  \uE000["style",[["token","primary"]]]\uE001One plain line.\uE002',
  ]);
});

test.each([
  ['# ###', []],
  ['- first\n  - nested\nlazy', ['  - first', '    - nested', '      lazy']],
  ['- ```\n  code\noutside', ['  -   code', '  outside']],
])('container edge %j follows the stated block rules', async (source, lines) => {
  await expect(render(source)).resolves.toBe(page(lines));
});

test('an image in link text contributes its destination to printable text equality', async () => {
  await expect(render('[![image](img)](image)')).resolves.toBe(page(['  image (img) (image)']));
});

test('an unmatched backtick run never opens a span from its middle', async () => {
  await expect(render('``open`end', { themed: true })).resolves.toBe(
    themedPage(['  \u001b[32m``open`end\u001b[39m'], false),
  );
});

test('underscore boundaries recognize astral Unicode letters on either side', async () => {
  await expect(render('𐐀_name_ _name_𐐀')).resolves.toBe(page(['  𐐀_name_ _name_𐐀']));
});

test('an autolink protects its address brackets inside link text', async () => {
  await expect(render('[<https://a]>](url)')).resolves.toBe(page(['  https://a] (url)']));
});

test('code inside a list keeps every interior empty line', async () => {
  await expect(render('- ```\n  code\n\n\n  last\n  ```')).resolves.toBe(
    page(['  -   code', '', '', '      last']),
  );
});

test('empty headings create no parser block and retain an authored separator', () => {
  expect(parseMarkdown('#\n# ###')).toEqual([]);
  expect(parseMarkdown('one\n\n#\ntwo')).toMatchObject([
    { blankBefore: false, kind: 'paragraph' },
    { blankBefore: true, kind: 'paragraph' },
  ]);
});
