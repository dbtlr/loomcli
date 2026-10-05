import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/help-sections.mjs', import.meta.url);

function page(...lines: string[]) {
  return { status: 0, stderr: '', stdout: `${lines.join('\n')}\n` };
}

test('section paths and page orders are frozen help metadata, without installing help', () => {
  const result = invoke(fixture, ['metadata']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(JSON.parse(result.stdout)).toEqual({
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
  (spelling) => {
    expect(invoke(fixture, ['commands', spelling])).toEqual(
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

test('named sections combine local and global options, preserve direct members, and fold defaults on a childless root', () => {
  expect(invoke(fixture, ['options', '--help'])).toEqual(
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
  (scenario) => {
    const first =
      scenario === 'ordered' ? [...machinery, '', ...work] : [...work, '', ...machinery];
    expect(invoke(fixture, [scenario, '--help'])).toEqual(
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

test('invalid paths are rejected by ordinary extension validation in every declaration slot', () => {
  const result = invoke(fixture, ['invalid']);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  const rejected: unknown = JSON.parse(result.stdout);
  expect(rejected).toHaveLength(36);
  expect(rejected).toEqual(Array(36).fill('@loomcli/core/invalid-extension-value'));
});

test.each(['--help', '-h'])(
  'named-only child listings keep the %s hint without printing COMMANDS',
  (spelling) => {
    const result = invoke(fixture, ['named-only', spelling]);
    expect(result.status).toBe(0);
    expect(result.stderr).toBe('');
    expect(result.stdout).not.toContain('\nCOMMANDS\n');
    expect(result.stdout).toContain(`Run work <command> ${spelling} for command details.\n`);
  },
);

test('a child page owns option order, can reverse defaults, and lists plugin globals in authored sections', () => {
  expect(invoke(fixture, ['scoped', 'tools', '--help'])).toEqual(
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

test('a nested Command uses its own child section order, without enclosing its page in its membership', () => {
  expect(invoke(fixture, ['child-order', 'tools', '--help'])).toEqual(
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

test('grouping preserves graph authoring order, including hidden and plugin-attached Commands', () => {
  const result = invoke(fixture, ['graph']);
  expect(result.status).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual([
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

test('nested rows measure terminal columns and literal heading markers print without markup', () => {
  expect(invoke(fixture, ['wide', '--help'])).toEqual(
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
  const styled = invoke(fixture, ['wide-styled', '--help']);
  expect(styled.status).toBe(0);
  expect(styled.stderr).toBe('');
  expect(styled.stdout).toContain(
    '\u001b[90mOUT\uE001PUT\u001b[39m\n  \u001b[90mFI\uE002LES\u001b[39m\n',
  );
});

test('completion keeps canonical graph order and core descriptions under help section ordering', () => {
  expect(invoke(fixture, ['completion', 'completion', '__complete', '--', ''])).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'completion\tPrint a shell completion script.\nalpha\tRead first.\nbeta\tRead last.\n:4\n',
  });
});
