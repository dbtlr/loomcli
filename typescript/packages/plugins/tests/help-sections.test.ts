import { expect, test } from 'vite-plus/test';
/*
 * Acceptance plan for ordered help sections (docs/plugins/help.md#ordered-help-sections).
 *
 * Public API fixtures prove the following rules under Node and Bun, including rendered output and
 * packed-package checks.
 *
 * - Paths and storage. One-level and two-level membership compile and reach the frozen extension
 *   values, whether help is installed or not. An empty path, a three-entry path, and a non-string
 *   heading fail TypeScript checks and ordinary extension validation. A blank or multiline heading
 *   fails the `line` rule. The same checks apply to entries in either order list. Membership paths
 *   whose headings have the same uppercase form combine, order entries match that same form, and
 *   title-case references such as `Global options` match default headings. Stored strings retain
 *   their authored spelling.
 * - Commands. A page with direct and nested sections, unsectioned children, interleaved order
 *   entries, duplicate entries, unlisted sections, and an entry for an absent section pins the
 *   heading and member order. A two-entry order path for an absent or entirely hidden subsection
 *   does not position its visible outer heading. A parent-only order entry positions that outer
 *   heading when another subsection is visible. A child page uses its own ordering, while that
 *   child's membership affects only its row on the parent page. Plugin-attached Commands use the
 *   same membership rules.
 * - Options. `optionSections` orders local and global sections together, including GLOBAL OPTIONS
 *   before OPTIONS when explicitly listed that way. Direct and nested option sections cover
 *   partial, interleaved, repeated, parent-only, and absent order entries. A child's page uses its
 *   own order for global and local members even when the root declares an option order. Every
 *   option section remains after ARGUMENTS. A named section combines a local option and a global
 *   option, with local members first. A childless root folds unsectioned globals into OPTIONS,
 *   while a page with children retains the two default sections. A root with hidden children alone
 *   retains GLOBAL OPTIONS as today. An authored default path joins the default section. Global
 *   options declared by a plugin follow the same rules.
 * - Filtering and layout. Hidden members create no headings and affect no widths. An outer heading
 *   containing only visible subsections remains. Golden bytes pin two-space inner headings,
 *   four-space inner rows, two-space direct rows, blank lines, and the final newline. Wide and
 *   combining characters align using the existing width rules. Marker characters in headings print
 *   literally under both plain and styled output.
 * - Variants and other projections. Compact and extended pages have the same section layout, with
 *   their existing differences in details, examples, and hints. Both variants retain the child hint
 *   when every visible child uses an authored section and no COMMANDS heading prints. A whole-page
 *   replacement can read section fields through `readExtension`. The manifest receives details and
 *   examples alone, and its graph order and completion output are unchanged.
 * - Compatibility and delivery. Unsectioned fixture pages remain byte-for-byte unchanged. Both
 *   examples opt into authored sections through the public descriptors, and packed-package checks
 *   exercise grouped help under Node and Bun. An ordinary change fragment describes the new fields
 *   and layout. No version field changes in the implementation PR.
 */

import { graphOrder, metadata, run as fixtureRun } from './fixtures/help-sections.js';
import { rejectedSections } from './fixtures/invalid-help-sections.mjs';

function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

test('section paths and page orders are frozen help metadata, without installing help', async () => {
  expect(metadata()).toEqual({
    command: {
      commandSections: [['Work', 'Read']],
      optionSections: [['Output']],
      section: [' Root ', 'Unused'],
    },
    frozen: true,
    input: { section: ['Output', 'Logging'] },
  });
});

test.each(['--help', '-h'])(
  'nested Command sections replace defaults on %s and retain the child hint',
  async (spelling) => {
    await expect(fixtureRun(['commands', spelling])).resolves.toEqual(
      page(
        'work',
        '',
        'USAGE',
        '  work <command> [options]',
        '',
        'WORK COMMANDS',
        '  READ',
        '    next  Find ready tasks.',
        '  LIFECYCLE',
        '    done  Complete a task.',
        '',
        'COMMANDS',
        '  doctor  Check the application.',
        '',
        'GLOBAL OPTIONS',
        '  -h, --help  Show this help.',
        '',
        `Run work <command> ${spelling} for command details.`,
      ),
    );
  },
);

test('named sections combine local and global options, preserve direct members, and fold defaults on a childless root', async () => {
  await expect(fixtureRun(['options', '--help'])).resolves.toEqual(
    page(
      'report',
      '',
      'USAGE',
      '  report <files...> [options]',
      '',
      'ARGUMENTS',
      '  files  Files to read.',
      '',
      'OUTPUT',
      '      --stream  Stream results.',
      '  LOGGING',
      '    -l, --log  Print logs.',
      '  FORMAT',
      '    -f, --format <format>  Select the format.',
      '    -q, --quiet            Suppress progress.',
      '',
      'OPTIONS',
      '      --strict  Reject unreadable files.',
      '  -h, --help    Show this help.',
    ),
  );
});

const work = [
  'WORK',
  '  status  Show status.',
  '  READ',
  '    next      Find tasks.',
  '    overview  Project overview.',
  '  LIFECYCLE',
  '    done  Finish work.',
  '  EDIT',
  '    move  Move work.',
];
const machinery = ['MACHINERY', '  info  Inspect machinery.'];

test.each(['ordered', 'parent-order'])(
  'partial order %s ignores hidden paths and keeps outer sections contiguous',
  async (scenario) => {
    const first =
      scenario === 'ordered' ? [...machinery, '', ...work] : [...work, '', ...machinery];
    await expect(fixtureRun([scenario, '--help'])).resolves.toEqual(
      page(
        'ordered',
        '',
        'USAGE',
        '  ordered <command> [options]',
        '',
        ...first,
        '',
        'EXTRA',
        '  extra  More work.',
        '',
        'COMMANDS',
        '  doctor',
        '',
        'ALPHA',
        '  alpha',
        '',
        'ZETA',
        '  zeta',
        '',
        'GLOBAL OPTIONS',
        '  -h, --help  Show this help.',
        '',
        'Run ordered <command> --help for command details.',
      ),
    );
  },
);

test('invalid paths are rejected by ordinary extension validation in every declaration slot', async () => {
  const rejected = rejectedSections();
  expect(rejected).toHaveLength(36);
  expect(rejected).toEqual(Array(36).fill('@loomcli/core/invalid-extension-value'));
});

test.each(['--help', '-h'])(
  'named-only child listings keep the %s hint without printing COMMANDS',
  async (spelling) => {
    const result = await fixtureRun(['named-only', spelling]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\nCOMMANDS\n');
    expect(result.stdout).toContain(`Run work <command> ${spelling} for command details.\n`);
  },
);

test('a child page owns option order, can reverse defaults, and lists plugin globals in authored sections', async () => {
  await expect(fixtureRun(['scoped', 'tools', '--help'])).resolves.toEqual(
    page(
      'scoped tools',
      '',
      'USAGE',
      '  scoped tools <file> [options]',
      '',
      'ARGUMENTS',
      '  file  File to read.',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help  Show this help.',
      '',
      'OPTIONS',
      '      --mode  Use mode.',
      '',
      'OUTPUT',
      '  -q, --quiet  Say less.',
      '',
      'TRACE',
      '      --trace  Trace calls.',
    ),
  );
});

test('a nested Command uses its own child section order, without enclosing its page in its membership', async () => {
  await expect(fixtureRun(['child-order', 'tools', '--help'])).resolves.toEqual(
    page(
      'nested tools',
      '',
      'USAGE',
      '  nested tools <command> [options]',
      '',
      'READ',
      '  read',
      '',
      'EDIT',
      '  edit',
      '',
      'GLOBAL OPTIONS',
      '  -h, --help  Show this help.',
      '',
      'Run nested tools <command> --help for command details.',
    ),
  );
});

test('grouping preserves graph authoring order, including hidden and plugin-attached Commands', async () => {
  expect(graphOrder()).toEqual([
    'info',
    'hidden',
    'doctor',
    'next',
    'move',
    'done',
    'overview',
    'status',
    'archive',
    'extra',
    'alpha',
    'zeta',
  ]);
});

test('nested rows measure terminal columns and literal heading markers print without markup', async () => {
  await expect(fixtureRun(['wide', '--help'])).resolves.toEqual(
    page(
      'wide',
      '',
      'USAGE',
      '  wide [options]',
      '',
      'OUT\uE001PUT',
      '  FI\uE002LES',
      '    -F, --field <界界>  Fields.',
      '    -x <é>              Short.',
      '',
      'OPTIONS',
      '  -h, --help  Show this help.',
    ),
  );
  const styled = await fixtureRun(['wide-styled', '--help']);
  expect(styled.status).toBe(0);
  expect(styled.stderr).toBe('');
  expect(styled.stdout).toContain(
    '\u001b[90mOUT\uE001PUT\u001b[39m\n  \u001b[90mFI\uE002LES\u001b[39m\n',
  );
});

test('completion keeps canonical graph order and core descriptions under help section ordering', async () => {
  await expect(fixtureRun(['completion', 'completion', '__complete', '--', ''])).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout:
      'completion\tPrint or install a shell completion script.\nalpha\tRead first.\nbeta\tRead last.\n:4\n',
  });
});
