import { spawnSync } from 'node:child_process';

import { Application, Command, DeclarationError } from '@loomcli/core';
import { describe, expect, it } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';
import { ruleParts } from '../../../scripts/test-rules.js';
import { findOnPath } from '../../../scripts/test-shell.js';
import { configInput } from '../src/config/extension.js';
import { helpCommand, helpInput } from '../src/help/extension.js';
import { manPages } from '../src/manpage/page.js';
import { manpage } from '../src/manpage/plugin.js';

const noop = () => undefined;

/** Each page of an application's set by file name, as `generate` and `install` write them. */
function pagesOf(application: { inspect: () => Parameters<typeof manPages>[0] }) {
  return new Map(manPages(application.inspect()).map(({ file, text }) => [file, text]));
}

/** A page as its lines, each ended by a line feed. */
function page(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

const level = new Command('level', {
  description: 'Set the level.',
  extensions: [
    helpCommand({
      examples: [{ command: 'level --color', note: 'Turn color on.' }, { command: 'level -q' }],
      optionSections: [['Output', 'Shape'], ['Output']],
      section: ['Work', 'Change'],
    }),
  ],
})
  .option('color', {
    description: 'Color the output.',
    env: 'KIT_COLOR',
    extensions: [helpInput({ section: ['Output'] })],
    polarity: 'both',
    type: 'boolean',
  })
  .option('pager', {
    description: 'Use the pager.',
    env: 'KIT_PAGER',
    polarity: 'negative',
    type: 'boolean',
  })
  .option('quiet', {
    description: 'Say less.',
    env: 'KIT_QUIET',
    short: 'q',
    shortOnly: true,
    type: 'boolean',
  })
  .option('debug', { description: 'Debug more.', env: 'KIT_DEBUG', short: 'd', type: 'count' })
  .option('backup', {
    description: 'Back up first.',
    extensions: [helpInput({ placeholder: 'control', section: ['Output', 'Shape'] })],
    implied: 'simple',
    short: 'b',
    type: 'string',
  })
  .option('mode', {
    description: 'The mode.',
    env: ['KIT_MODE', 'KIT_LEGACY_MODE'],
    extensions: [configInput({ path: 'level.mode' })],
    type: 'string',
    validate: z.enum(['fast', 'slow']),
  })
  .option('secret', { description: 'Hidden.', env: 'KIT_SECRET', hidden: true, type: 'string' })
  .option('plain', { description: 'Long only.', type: 'boolean' })
  .option('raw', { env: 'KIT_RAW', type: 'boolean' })
  .action(noop);

const show = new Command('show', {
  description: 'Show the kit.',
  extensions: [helpCommand({ section: ['Work', 'Read'] })],
})
  .argument('name', { description: 'The part to show.', required: true })
  .action(noop);

const bare = new Command('bare').action(noop);

/** An application that installs neither help nor the configuration plugin. */
const kit = new Application('kit', {
  description: 'A kit.',
  extensions: [
    helpCommand({
      commandSections: [
        ['Work', 'Read'],
        ['Work', 'Change'],
      ],
    }),
  ],
  plugins: [manpage()],
  version: '1.2.3',
})
  .globalOption('file', {
    description: 'The file to read.',
    env: 'KIT_FILE',
    extensions: [helpInput({ placeholder: 'path' })],
    short: 'f',
    type: 'string',
  })
  .globalOption('verbose', {
    description: 'Say more.',
    extensions: [helpInput({ section: ['Logging'] })],
    short: 'v',
    type: 'count',
  })
  .command(level)
  .command(show)
  .command(bare);

describe('the page set', () => {
  it('holds a page for the root, each visible child, and the plugin Commands', () => {
    expect([...pagesOf(kit).keys()]).toEqual([
      'kit.1',
      'kit-manpage.1',
      'kit-manpage-generate.1',
      'kit-manpage-install.1',
      'kit-manpage-update.1',
      'kit-manpage-uninstall.1',
      'kit-level.1',
      'kit-show.1',
      'kit-bare.1',
    ]);
  });

  it('gives no page to a hidden Command or one under it, nor to an alias', () => {
    const app = new Application('kit', { description: 'A kit.', plugins: [manpage()] })
      .command(
        new Command('secret', { description: 'Hidden.', hidden: true }).command(
          new Command('inner', { description: 'Under a hidden Command.' }).action(noop),
        ),
      )
      .command(new Command('list', { description: 'List.' }).alias('ls').action(noop));
    const pages = pagesOf(app);
    expect([...pages.keys()].filter((file) => !file.startsWith('kit-manpage'))).toEqual([
      'kit.1',
      'kit-list.1',
    ]);
    expect(pages.get('kit.1')).not.toMatch(/secret|\bls\b/u);
  });
});

describe('sections', () => {
  it('the root page lists its sections in help order and the globals, under GLOBAL OPTIONS or an authored section', () => {
    expect(pagesOf(kit).get('kit.1')).toBe(
      page(
        '.TH "KIT" "1" "" "kit 1.2.3" ""',
        '.SH "NAME"',
        String.raw`kit \- A kit.`,
        '.SH "SYNOPSIS"',
        '.nf',
        String.raw`\fBkit\fR <command> [options]`,
        '.fi',
        '.SH "WORK"',
        '.SS "READ"',
        '.TP',
        String.raw`\fBshow\fR`,
        'Show the kit.',
        '.SS "CHANGE"',
        '.TP',
        String.raw`\fBlevel\fR`,
        'Set the level.',
        '.SH "COMMANDS"',
        '.TP',
        String.raw`\fBmanpage\fR <command>`,
        'Write or install the man pages.',
        '.TP',
        String.raw`\fBbare\fR`,
        '.SH "GLOBAL OPTIONS"',
        '.TP',
        String.raw`\fB\-f\fR, \fB\-\-file\fR <\fIpath\fR>`,
        'The file to read.',
        '.br',
        String.raw`Environment: \fBKIT_FILE\fR`,
        '.SH "LOGGING"',
        '.TP',
        String.raw`\fB\-v\fR, \fB\-\-verbose\fR...`,
        'Say more.',
        '.SH "ENVIRONMENT"',
        '.TP',
        String.raw`\fBKIT_FILE\fR`,
        String.raw`Supplies \fB\-\-file\fR.`,
        '.SH "SEE ALSO"',
        String.raw`\fBkit\-show\fR(1), \fBkit\-level\fR(1), \fBkit\-manpage\fR(1), \fBkit\-bare\fR(1)`,
      ),
    );
  });

  it('a child page holds its own options in help order, its examples, and its environment, and no global', () => {
    expect(pagesOf(kit).get('kit-level.1')).toBe(
      page(
        String.raw`.TH "KIT\-LEVEL" "1" "" "kit 1.2.3" ""`,
        '.SH "NAME"',
        String.raw`kit\-level \- Set the level.`,
        '.SH "SYNOPSIS"',
        '.nf',
        String.raw`\fBkit level\fR [options]`,
        '.fi',
        '.SH "OUTPUT"',
        '.TP',
        String.raw`\fB\-\-[no\-]color\fR`,
        'Color the output.',
        '.br',
        String.raw`Environment: \fBKIT_COLOR\fR`,
        '.SS "SHAPE"',
        '.TP',
        String.raw`\fB\-b\fR, \fB\-\-backup\fR[=<\fIcontrol\fR>]`,
        'Back up first.  (implied: simple)',
        '.SH "OPTIONS"',
        '.TP',
        String.raw`\fB\-\-no\-pager\fR`,
        'Use the pager.  (default: true)',
        '.br',
        String.raw`Environment: \fBKIT_PAGER\fR`,
        '.TP',
        String.raw`\fB\-q\fR`,
        'Say less.',
        '.br',
        String.raw`Environment: \fBKIT_QUIET\fR`,
        '.TP',
        String.raw`\fB\-d\fR, \fB\-\-debug\fR...`,
        'Debug more.',
        '.br',
        String.raw`Environment: \fBKIT_DEBUG\fR`,
        '.TP',
        String.raw`\fB\-\-mode\fR <\fImode\fR>`,
        'The mode. One of: fast, slow.',
        '.br',
        String.raw`Environment: \fBKIT_MODE\fR, \fBKIT_LEGACY_MODE\fR`,
        '.br',
        String.raw`Configuration: \fBlevel.mode\fR`,
        '.TP',
        String.raw`\fB\-\-plain\fR`,
        'Long only.',
        '.TP',
        String.raw`\fB\-\-raw\fR`,
        String.raw`Environment: \fBKIT_RAW\fR`,
        '.SH "EXAMPLES"',
        '.nf',
        String.raw`\fB$ kit level \-\-color\fR`,
        '.fi',
        '.RS 4',
        'Turn color on.',
        '.RE',
        '.PP',
        '.nf',
        String.raw`\fB$ kit level \-q\fR`,
        '.fi',
        '.SH "ENVIRONMENT"',
        '.TP',
        String.raw`\fBKIT_COLOR\fR`,
        String.raw`Supplies \fB\-\-[no\-]color\fR.`,
        '.TP',
        String.raw`\fBKIT_PAGER\fR`,
        String.raw`Supplies \fB\-\-no\-pager\fR.`,
        '.TP',
        String.raw`\fBKIT_QUIET\fR`,
        String.raw`Supplies \fB\-q\fR.`,
        '.TP',
        String.raw`\fBKIT_DEBUG\fR`,
        String.raw`Supplies \fB\-\-debug\fR.`,
        '.TP',
        String.raw`\fBKIT_MODE\fR`,
        String.raw`Supplies \fB\-\-mode\fR.`,
        '.TP',
        String.raw`\fBKIT_LEGACY_MODE\fR`,
        String.raw`Supplies \fB\-\-mode\fR.`,
        '.TP',
        String.raw`\fBKIT_RAW\fR`,
        String.raw`Supplies \fB\-\-raw\fR.`,
        '.SH "SEE ALSO"',
        String.raw`\fBkit\fR(1)`,
      ),
    );
  });

  it('a Command with no description has the page name alone under NAME', () => {
    expect(pagesOf(kit).get('kit-bare.1')).toBe(
      page(
        String.raw`.TH "KIT\-BARE" "1" "" "kit 1.2.3" ""`,
        '.SH "NAME"',
        String.raw`kit\-bare`,
        '.SH "SYNOPSIS"',
        '.nf',
        String.raw`\fBkit bare\fR [options]`,
        '.fi',
        '.SH "SEE ALSO"',
        String.raw`\fBkit\fR(1)`,
      ),
    );
  });

  it('an argument is italic, and a page under a group names the root and its parent', () => {
    const pages = pagesOf(kit);
    expect(pages.get('kit-show.1')).toContain(
      ['.SH "ARGUMENTS"', '.TP', String.raw`\fIname\fR`, 'The part to show.'].join('\n'),
    );
    expect(pages.get('kit-manpage-generate.1')).toContain(
      [
        '.SH "SYNOPSIS"',
        '.nf',
        String.raw`\fBkit manpage generate\fR \-\-out <folder> [options]`,
        '.fi',
      ].join('\n'),
    );
    expect(pages.get('kit-manpage-generate.1')).toContain(
      [
        '.TP',
        String.raw`\fB\-\-out\fR <\fIfolder\fR>`,
        'The folder to write the man pages in. It is created when missing.  (required)',
      ].join('\n'),
    );
    expect(pages.get('kit-manpage-install.1')?.split('\n').at(-2)).toBe(
      String.raw`\fBkit\fR(1), \fBkit\-manpage\fR(1)`,
    );
    expect(pages.get('kit-manpage.1')?.split('\n').at(-2)).toBe(
      String.raw`\fBkit\fR(1), \fBkit\-manpage\-generate\fR(1), \fBkit\-manpage\-install\fR(1), \fBkit\-manpage\-update\fR(1), \fBkit\-manpage\-uninstall\fR(1)`,
    );
  });

  it('a deprecated Command opens its DESCRIPTION with its message and its parent marks the entry', () => {
    const app = new Application('kit', { description: 'A kit.', plugins: [manpage()] }).command(
      new Command('old', {
        deprecated: 'Use new.',
        description: 'Old.',
        extensions: [helpCommand({ details: 'Still works.' })],
      }).action(noop),
    );
    const pages = pagesOf(app);
    expect(pages.get('kit-old.1')).toContain(
      ['.SH "DESCRIPTION"', 'Deprecated: Use new.', '.PP', 'Still works.'].join('\n'),
    );
    expect(pages.get('kit.1')).toContain(
      ['.TP', String.raw`\fBold\fR`, 'Old.  (deprecated: Use new.)'].join('\n'),
    );
  });

  it('a line break in a description, a deprecation, or the stdin description reads as a space', () => {
    const app = new Application('kit', {
      description: 'First line.\nSecond line.',
      plugins: [manpage()],
    })
      .command(
        new Command('old', {
          deprecated: 'Use new.\r\nIt is faster.',
          description: 'Old line.\nOld more.',
        }).action(noop),
      )
      .command(
        new Command('read', { description: 'Read line.\r\nRead more.' })
          .argument('name', { description: 'Name line.\nName more.' })
          .option('fast', { description: 'Fast line.\nFast more.', type: 'boolean' })
          .stdin({ description: 'Input line.\nInput more.' })
          .action(noop),
      );
    const pages = pagesOf(app);
    expect(pages.get('kit.1')).toContain(
      ['.SH "NAME"', String.raw`kit \- First line. Second line.`].join('\n'),
    );
    expect(pages.get('kit.1')).toContain(
      ['.TP', String.raw`\fBread\fR`, 'Read line. Read more.'].join('\n'),
    );
    expect(pages.get('kit.1')).toContain(
      [
        '.TP',
        String.raw`\fBold\fR`,
        'Old line. Old more.  (deprecated: Use new. It is faster.)',
      ].join('\n'),
    );
    expect(pages.get('kit-old.1')).toContain(
      ['.SH "NAME"', String.raw`kit\-old \- Old line. Old more.`].join('\n'),
    );
    expect(pages.get('kit-old.1')).toContain(
      ['.SH "DESCRIPTION"', 'Deprecated: Use new. It is faster.'].join('\n'),
    );
    const read = pages.get('kit-read.1');
    expect(read).toContain(
      ['.SH "NAME"', String.raw`kit\-read \- Read line. Read more.`].join('\n'),
    );
    expect(read).toContain(['.SH "INPUT"', 'Input line. Input more.'].join('\n'));
    expect(read).toContain(['.TP', String.raw`\fIname\fR`, 'Name line. Name more.'].join('\n'));
    expect(read).toContain(['.TP', String.raw`\fB\-\-fast\fR`, 'Fast line. Fast more.'].join('\n'));
    for (const text of pages.values()) {
      expect(text).not.toMatch(/\\eu000/iu);
    }
  });

  it('a root whose authored option section holds a global lists it there, and its child page does not', () => {
    const pages = pagesOf(kit);
    expect(pages.get('kit.1')).toContain('.SH "LOGGING"');
    expect(pages.get('kit-show.1')).not.toMatch(/LOGGING|GLOBAL OPTIONS|verbose|KIT_FILE/u);
  });
});

describe('names that collide', () => {
  it.each<[string, () => { inspect: () => unknown }, string]>([
    [
      'a root child foo-bar beside foo bar',
      () =>
        new Application('kit', { description: 'A kit.', plugins: [manpage()] })
          .command(new Command('foo-bar', { description: 'Flat.' }).action(noop))
          .command(
            new Command('foo', { description: 'Group.' }).command(
              new Command('bar', { description: 'Nested.' }).action(noop),
            ),
          ),
      'Commands "foo-bar" and "foo bar" both give the man page kit-foo-bar.',
    ],
  ])('%s fails the build under page-name-taken', (_name, build, sentence) => {
    let thrown: unknown = undefined;
    try {
      build().inspect();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(DeclarationError);
    expect(thrown).toMatchObject({
      correction: 'Rename one of them, or hide one.',
      rule: { identity: '@loomcli/plugins/manpage/page-name-taken' },
      sentence,
    });
  });

  it.each<[string, string]>([
    ['hyphen', 'Commands "foo-bar" and "foo bar" both give the man page kit-foo-bar.'],
  ])('the %s collision fails every run with the pinned diagnostic', (scenario, sentence) => {
    const collide = new URL('fixtures/manpage-collide.mjs', import.meta.url);
    for (const argv of [['manpage', 'install'], ['--help']]) {
      const developed = invoke(collide, [scenario, ...argv], {
        env: { FIXTURE_BUILD: 'development' },
      });
      expect(developed).toMatchObject({ status: 1, stdout: '' });
      expect(ruleParts(developed.stderr)).toEqual({
        correction: 'Rename one of them, or hide one.',
        identity: '@loomcli/plugins/manpage/page-name-taken',
        sentence,
      });
      expect(invoke(collide, [scenario, ...argv])).toEqual({
        status: 1,
        stderr: 'kit: Something went wrong.\n',
        stdout: '',
      });
    }
  });

  it('a hidden Command gives no page, so the same graph builds', () => {
    const app = new Application('kit', { description: 'A kit.', plugins: [manpage()] })
      .command(new Command('foo-bar', { description: 'Flat.', hidden: true }).action(noop))
      .command(
        new Command('foo', { description: 'Group.' }).command(
          new Command('bar', { description: 'Nested.' }).action(noop),
        ),
      );
    expect([...pagesOf(app).keys()]).toContain('kit-foo-bar.1');
  });
});

/** A string holding every character the escapes rule names, with an escape and non-ASCII text. */
const hostile = `.lead 'q' "dq" \`bt\` ^c ~t \\b \\fB a-b ${String.fromCodePoint(0x1b)} caf${String.fromCodePoint(0xe9)} ${String.fromCodePoint(0x20_14)} ${String.fromCodePoint(0x4e_2d)}`;

/** The text a reader sees: hostile with its escape character shown as its escape. */
const shownHostile = hostile.replace(String.fromCodePoint(0x1b), String.raw`\u001b`);

/** Hostile with one backtick, which Markdown details print as written rather than as a code span. */
const detailsHostile = hostile.replace('`bt`', '`bt');

/** The text a reader sees of the details' hostile string. */
const shownDetails = detailsHostile.replace(String.fromCodePoint(0x1b), String.raw`\u001b`);

/**
 * The same characters in a version short enough for the footer: groff's man macros warn that they
 * cannot abbreviate a fourth `.TH` argument wider than half the line when it holds an escape.
 */
const compact = `.'"\`^~\\\\fB-${String.fromCodePoint(0x1b)}${String.fromCodePoint(0xe9)}${String.fromCodePoint(0x4e_2d)}`;

const groff = findOnPath('groff');

/** A page as groff renders it in UTF-8, without fonts, on lines too long to wrap. */
function rendered(text: string): string {
  const result = spawnSync('groff', ['-man', '-Tutf8', '-rLL=400n', '-P', '-cbou'], {
    encoding: 'utf8',
    input: text,
  });
  return result.stdout;
}

/** What `groff -ww -z` reports for a page: nothing for a clean one. */
function lint(text: string): string {
  return spawnSync('groff', ['-man', '-Tutf8', '-ww', '-z'], { encoding: 'utf8', input: text })
    .stderr;
}

const escapes = new Application('kit', {
  description: hostile,
  extensions: [
    helpCommand({
      details: [detailsHostile, '', `# ${detailsHostile}`, '', '```', hostile, 'a\tb', '```'].join(
        '\n',
      ),
      examples: [{ command: hostile, note: hostile }],
      optionSections: [[hostile]],
    }),
  ],
  plugins: [manpage()],
  version: compact,
})
  .option('tab', {
    description: 'One\ttab.',
    extensions: [helpInput({ section: [hostile] })],
    type: 'boolean',
  })
  .command(new Command('child', { description: hostile }).action(noop))
  .action(noop);

describe('escapes', () => {
  it('every page is ASCII', () => {
    for (const text of pagesOf(escapes).values()) {
      expect(text).toMatch(/^[\n\t -~]*$/u);
    }
  });

  it.skipIf(groff === undefined)(
    'every string renders as the characters written, the escape character shown as its escape',
    () => {
      const pages = pagesOf(escapes);
      const root = rendered(pages.get('kit.1') ?? '');
      const rows = root.split('\n');
      // The description in NAME, the code line, the child's row, the example, and its note.
      expect(root.split(shownHostile).length - 1).toBe(5);
      // The details paragraph, in DESCRIPTION's indent, and the details heading, an .SS.
      expect(rows).toContain(`       ${shownDetails}`);
      expect(rows).toContain(`   ${shownDetails}`);
      expect(root).toContain(`$ kit ${shownHostile}`);
      expect(root).toContain(`kit ${shownHostile}`);
      // A heading keeps its quote, and an authored help section heading prints in uppercase.
      expect(root).toContain(
        shownHostile.toUpperCase().replace(String.raw`\U001B`, String.raw`\u001b`),
      );
      // The version, in the footer.
      const footer = root.trimEnd().split('\n').at(-1) ?? '';
      expect(
        footer.startsWith(
          `kit ${compact.replace(String.fromCodePoint(0x1b), String.raw`\u001b`)} `,
        ),
      ).toBe(true);
      // A tab in a code line, indented by DESCRIPTION and the code block, moves to the next stop.
      expect(root).toMatch(/^ {11}a {4}b$/mu);
      expect(root).toContain('One tab.');
      expect(rendered(pages.get('kit-child.1') ?? '')).toContain(shownHostile);
    },
  );

  it.skipIf(groff === undefined)('groff reports nothing for any page', () => {
    for (const text of [...pagesOf(escapes).values(), ...pagesOf(kit).values()]) {
      expect(lint(text)).toBe('');
    }
  });
});
