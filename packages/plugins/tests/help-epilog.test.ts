/*
 * Acceptance plan for help epilogs (docs/plugins/help-page.md#epilogs, ADR-0143).
 *
 * Epilogs are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Stacking. A leaf page under two groups that carry epilogs ends with the leaf's own, then each
 *   ancestor's, then the Application's, each its own block after the hints, and the root page ends
 *   with the Application's alone. A hidden group on the path contributes its epilog, and two equal
 *   epilogs on one path both print.
 * - Variants. `-h` and `--help` print the same epilogs, and a compact page whose node has no
 *   Details and no EXAMPLES prints no pointer to `--help` because of an epilog.
 * - Markdown. An epilog keeps its authored blank line between two blocks, off a terminal keeps each
 *   authored line, and on a 40-column terminal reflows its paragraph at its two-space indent.
 * - The help Command. `kit help stats depth max` prints the page `kit stats depth max --help` does,
 *   epilogs included.
 * - The value. A whitespace-only epilog faults at the call that receives it with the Markdown
 *   rule's sentence.
 * - The man page. The page of a nested Command holds NOTES after ENVIRONMENT and before SEE ALSO, with
 *   the same epilogs in the same order, a `.PP` between two paragraphs and none before an epilog
 *   that opens with a list item, and a page with no epilog on its path has no NOTES.
 * - The manifest. Help supplies no `manifestCommand` value for a Command whose help value holds an
 *   epilog alone.
 */

import { Application, Command, readExtension } from '@loomcli/core';
import { describe, expect, it, test } from 'vite-plus/test';

import { helpCommand } from '../src/help/extension.js';
import { help } from '../src/help/plugin.js';
import { manifestCommand } from '../src/manifest/extension.js';
import { manPages } from '../src/manpage/page.js';
import { runOnMock } from './fixtures/in-process.js';

const noop = () => undefined;

/** The kit fixture: an Application whose support link ends every page, and two groups that add theirs. */
function kit({ command = false, hiddenDepth = false } = {}) {
  const max = new Command('max', { description: 'Print the deepest level.' }).action(noop);
  const depth = new Command('depth', {
    description: 'Measure how deeply the document nests.',
    extensions: [helpCommand({ epilog: 'Depth counts from the root.' })],
    hidden: hiddenDepth,
  }).command(max);
  const stats = new Command('stats', {
    description: 'Report facts about the document.',
    extensions: [
      helpCommand({ epilog: 'Each statistic is described at https://example.com/stats.' }),
    ],
  }).command(depth);
  return new Application('kit', {
    description: 'A fixture kit.',
    extensions: [helpCommand({ epilog: 'Report a bug at https://example.com/kit/issues.' })],
    plugins: [help({ command })],
  }).command(stats);
}

/** The page one argv prints, off a terminal unless `columns` names a terminal width. */
async function pageOf(
  application: Pick<Application, 'run'>,
  argv: readonly string[],
  columns?: number,
): Promise<string> {
  const result = await runOnMock(
    application,
    {
      argv: [...argv],
      platform: 'linux',
      ...(columns === undefined ? {} : { terminal: { columns, rows: 24, streams: ['stdout'] } }),
    },
    { rendering: { color: 'never', hyperlinks: 'never', modifiers: 'never' } },
  );
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/** A page written by hand, as its lines. The view ends it with exactly one newline. */
function page(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

const leafEnd = [
  'GLOBAL OPTIONS',
  '  -h, --help  Show this help.',
  '',
  '  Depth counts from the root.',
  '',
  '  Each statistic is described at https://example.com/stats.',
  '',
  '  Report a bug at https://example.com/kit/issues.',
];

describe('stacking', () => {
  it.each([['-h'], ['--help']])(
    'a leaf page ends with its ancestors’ epilogs, nearest first and the Application’s last (%s)',
    async (spelling) => {
      await expect(pageOf(kit(), ['stats', 'depth', 'max', spelling])).resolves.toBe(
        page(
          'kit stats depth max · Print the deepest level.',
          '',
          'USAGE',
          '  kit stats depth max [options]',
          '',
          ...leafEnd,
        ),
      );
    },
  );

  it('a group page ends with its own epilog, then the Application’s, after the child hint', async () => {
    const text = await pageOf(kit(), ['stats', '--help']);
    expect(
      text.endsWith(
        page(
          'Run kit stats <command> --help for command details.',
          '',
          '  Each statistic is described at https://example.com/stats.',
          '',
          '  Report a bug at https://example.com/kit/issues.',
        ),
      ),
    ).toBe(true);
    expect(text).not.toContain('Depth counts from the root.');
  });

  it('the root page ends with the Application’s epilog alone', async () => {
    const text = await pageOf(kit(), ['-h']);
    expect(
      text.endsWith(
        page(
          'Run kit <command> -h for command details.',
          '',
          '  Report a bug at https://example.com/kit/issues.',
        ),
      ),
    ).toBe(true);
    expect(text).not.toContain('Run kit --help for details and examples.');
  });

  it('two equal epilogs on one path both print', async () => {
    const same = 'Report a bug at https://example.com/kit/issues.';
    const app = new Application('kit', {
      extensions: [helpCommand({ epilog: same })],
      plugins: [help()],
    }).command(new Command('leaf', { extensions: [helpCommand({ epilog: same })] }).action(noop));
    const text = await pageOf(app, ['leaf', '-h']);
    expect(text.endsWith(page('', `  ${same}`, '', `  ${same}`))).toBe(true);
  });

  it('a hidden group on the path still contributes its epilog', async () => {
    const text = await pageOf(kit({ hiddenDepth: true }), ['stats', 'depth', 'max', '-h']);
    expect(text.endsWith(page(...leafEnd))).toBe(true);
  });
});

describe('Markdown', () => {
  const long = 'Questions about this kit go to the support forum, which answers within a day.';
  const markdown = new Application('kit', {
    extensions: [helpCommand({ epilog: `${long}\nSee the forum.\n\n- One item.\n` })],
    plugins: [help()],
  }).action(noop);

  it('off a terminal an epilog keeps each authored line and its blank line between blocks', async () => {
    const text = await pageOf(markdown, ['-h']);
    expect(text.endsWith(page('', `  ${long}`, '  See the forum.', '', '  ● One item.'))).toBe(
      true,
    );
  });

  it('on a terminal an epilog paragraph reflows at its two-space indent', async () => {
    const text = await pageOf(markdown, ['-h'], 40);
    expect(
      text.endsWith(
        page(
          '',
          '  Questions about this kit go to the',
          '  support forum, which answers within a',
          '  day. See the forum.',
          '',
          '  ● One item.',
        ),
      ),
    ).toBe(true);
  });
});

test('the help Command prints the epilogs --help prints', async () => {
  const app = kit({ command: true });
  const byCommand = await pageOf(app, ['help', 'stats', 'depth', 'max']);
  expect(byCommand).toBe(await pageOf(app, ['stats', 'depth', 'max', '--help']));
  expect(byCommand).toContain('  Report a bug at https://example.com/kit/issues.\n');
});

test.each(['', ' \n\t'])(
  'a whitespace-only epilog %j faults at the call that receives it',
  (epilog) => {
    expect(() => new Application('kit').extend(helpCommand({ epilog }))).toThrow(
      'Supply Markdown that holds a character other than whitespace.',
    );
  },
);

describe('the man page', () => {
  it('a nested page prints its epilogs under NOTES, after ENVIRONMENT and before SEE ALSO', () => {
    const max = new Command('max', {
      description: 'Print the deepest level.',
      extensions: [
        helpCommand({ epilog: '- Levels count from one.', examples: [{ command: 'stats max' }] }),
      ],
    })
      .option('limit', { description: 'Stop at this level.', env: 'KIT_LIMIT', type: 'string' })
      .action(noop);
    const stats = new Command('stats', {
      description: 'Report facts.',
      extensions: [helpCommand({ epilog: 'Each statistic is described online.' })],
    }).command(max);
    const app = new Application('kit', {
      extensions: [helpCommand({ epilog: 'Report a bug at the tracker.' })],
    }).command(stats);
    const pages = new Map(manPages(app.inspect()).map(({ file, text }) => [file, text]));
    expect(pages.get('kit-stats-max.1')?.split('.SH "EXAMPLES"\n')[1]).toBe(
      page(
        '.nf',
        String.raw`\fB$ kit stats max\fR`,
        '.fi',
        '.SH "ENVIRONMENT"',
        '.TP',
        String.raw`\fBKIT_LIMIT\fR`,
        String.raw`Supplies \fB\-\-limit\fR.`,
        '.SH "NOTES"',
        String.raw`.IP \(bu 2`,
        'Levels count from one.',
        '.PP',
        'Each statistic is described online.',
        '.PP',
        'Report a bug at the tracker.',
        '.SH "SEE ALSO"',
        String.raw`\fBkit\fR(1), \fBkit\-stats\fR(1)`,
      ),
    );
    expect(pages.get('kit.1')).toContain(
      '.SH "NOTES"\nReport a bug at the tracker.\n.SH "SEE ALSO"',
    );
  });

  it('an epilog that opens with a list item writes no paragraph request before it', () => {
    const leaf = new Command('leaf', {
      extensions: [helpCommand({ epilog: 'First.' })],
    }).action(noop);
    const app = new Application('kit', {
      extensions: [helpCommand({ epilog: '- Second.' })],
    }).command(leaf);
    const [, leafPage] = manPages(app.inspect());
    expect(leafPage?.text).toContain('.SH "NOTES"\nFirst.\n.IP \\(bu 2\nSecond.\n.SH "SEE ALSO"');
  });

  it('a page with no epilog on its path has no NOTES', () => {
    const app = new Application('kit').command(new Command('leaf').action(noop));
    for (const { text } of manPages(app.inspect())) {
      expect(text).not.toContain('NOTES');
    }
  });
});

test('help supplies no manifest value for a Command whose help value holds an epilog alone', () => {
  const app = new Application('kit', {
    extensions: [helpCommand({ epilog: 'Report a bug at the tracker.' })],
    plugins: [help()],
  }).action(noop);
  expect(readExtension(app.inspect().root, manifestCommand) ?? []).toEqual([]);
});
