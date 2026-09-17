import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function run(options: Record<string, unknown> = {}) {
  return invoke(new URL('fixtures/help-style.mjs', import.meta.url), [JSON.stringify(options)]);
}

test('the version uses a bold highlighted name and primary version with an unstyled space', () => {
  expect(run({ rendering: { color: 'always', modifiers: 'always' }, version: 'v1.2.3' })).toEqual({
    status: 0,
    stderr: '',
    stdout: '\u001b[33;1mapp\u001b[39;22m v1.2.3\n',
  });
});

test('help styles each semantic fragment, including deprecation punctuation and opaque examples', () => {
  expect(run({ argv: ['--help'], rendering: { color: 'always', modifiers: 'always' } })).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '\u001b[33;1mapp\u001b[39;22m \u001b[90m·\u001b[39m Read values.',
      '',
      '  One line.',
      '',
      '\u001b[90mUSAGE\u001b[39m',
      '  \u001b[33mapp\u001b[39m \u001b[90;3m[options]\u001b[39;23m',
      '  \u001b[33mapp\u001b[39m \u001b[90;3m<command>\u001b[39;23m \u001b[90;3m[options]\u001b[39;23m',
      '',
      '\u001b[90mCOMMANDS\u001b[39m',
      '  \u001b[33mget\u001b[39m  Read one.  \u001b[90m(\u001b[93mdeprecated: Use read.\u001b[90m)\u001b[39m',
      '',
      '\u001b[90mGLOBAL OPTIONS\u001b[39m',
      '  \u001b[33m-h\u001b[90m,\u001b[39m \u001b[33m--help\u001b[39m     Show this help.',
      '  \u001b[33m-V\u001b[90m,\u001b[39m \u001b[33m--version\u001b[39m  Print the version.',
      '',
      '\u001b[90mEXAMPLES\u001b[39m',
      '  \u001b[90m$\u001b[39m \u001b[33mapp\u001b[39m get --raw «warning»',
      '    \u001b[90mLiteral flags.\u001b[39m',
      '',
      '\u001b[90mRun\u001b[39m \u001b[33mapp\u001b[39m \u001b[90;3m<command>\u001b[39;23m \u001b[33m--help\u001b[39m \u001b[90mfor command details.\u001b[39m',
      '',
    ].join('\n'),
  });
});

test.each([
  [{}, '33'],
  [{ TERM: 'xterm-256color' }, '38;5;172'],
  [{ COLORTERM: 'truecolor' }, '38;2;201;123;54'],
])('version follows the named palette depth: %j', (env, color) => {
  expect(run({ env, rendering: { color: 'always', modifiers: 'always' } })).toEqual({
    status: 0,
    stderr: '',
    stdout: `\u001b[${color};1mapp\u001b[39;22m v0.0.0\n`,
  });
});

test.each([
  [{}, 'app v0.0.0\n'],
  [{ env: { NO_COLOR: '1' }, tty: true }, '\u001b[1mapp\u001b[22m v0.0.0\n'],
  [
    { rendering: { color: 'always', modifiers: 'always' }, theme: 'absent' },
    '\u001b[1mapp\u001b[22m v0.0.0\n',
  ],
  [
    { rendering: { color: 'always', modifiers: 'always' }, theme: 'custom' },
    '\u001b[36;1mapp\u001b[39;22m \u001b[32mv0.0.0\u001b[39m\n',
  ],
  [{ rendering: { color: 'always', modifiers: 'never' } }, '\u001b[33mapp\u001b[39m v0.0.0\n'],
  [{ rendering: { color: 'never', modifiers: 'never' }, tty: true }, 'app v0.0.0\n'],
  [{ env: { FORCE_COLOR: '1', NO_COLOR: '1' } }, '\u001b[33;1mapp\u001b[39;22m v0.0.0\n'],
  [
    { env: { FORCE_COLOR: '1' }, rendering: { color: 'never', modifiers: 'never' } },
    'app v0.0.0\n',
  ],
])('version leaves capability and modifier policy to core: %j', (options, stdout) => {
  expect(run(options)).toEqual({ status: 0, stderr: '', stdout });
});

test.each(['0.0.0', 'v0.0.0', 'V0.0.0', '1.0.0\uE003'])(
  'version preserves literal graph data and normalization: %s',
  (version) => {
    const suffix = version === 'v0.0.0' ? 'v0.0.0' : `v${version}`;
    expect(
      run({
        argv: ['get', '--version'],
        name: 'app\uE001',
        rendering: { color: 'always', modifiers: 'always' },
        version,
      }),
    ).toEqual({
      status: 0,
      stderr: '',
      stdout: `\u001b[33;1mapp\uE001\u001b[39;22m ${suffix}\n`,
    });
  },
);

test('help measures wide and combining placeholders and escapes literal data before styling', () => {
  expect(
    run({ argv: ['--help'], leaf: true, rendering: { color: 'never', modifiers: 'never' } }),
  ).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '界é · Literal \uE001red\uE002.',
      '',
      '  Details \uE001.',
      '',
      'USAGE',
      '  界é <界...> --field <界界>... [options]',
      '',
      'ARGUMENTS',
      '  界  Wide.',
      '',
      'OPTIONS',
      '  -F, --field <界界>  Fields.  (required, repeatable, deprecated: Use new.)',
      '      --mode <mode>   Literal default.  (default: \uE001red\uE002x\uE003)',
      '      --no-quiet      (default: true)',
      '      --[no-]cache',
      '  -x <é>              Short.',
      '  -h, --help          Show this help.',
      '  -V, --version       Print the version.',
      '',
      'EXAMPLES',
      '  $ 界é --field \uE002',
      '    Note \uE003.',
      '',
    ].join('\n'),
  });
});

test('themed option cells separate spellings, placeholders, facts, and warning text', () => {
  const result = run({
    argv: ['--help'],
    leaf: true,
    rendering: { color: 'always', modifiers: 'always' },
  });
  expect(result.status).toBe(0);
  expect(result.stderr).toBe('');
  expect(result.stdout).toContain(
    '\u001b[33;1m界é\u001b[39;22m \u001b[90m·\u001b[39m Literal \uE001red\uE002.\n',
  );
  expect(result.stdout).toContain(
    '  \u001b[33m界é\u001b[39m \u001b[90;3m<界...>\u001b[39;23m \u001b[33m--field\u001b[39m \u001b[90;3m<界界>...\u001b[39;23m \u001b[90;3m[options]\u001b[39;23m\n',
  );
  expect(result.stdout).toContain(
    '  \u001b[33m-F\u001b[90m,\u001b[39m \u001b[33m--field\u001b[39m \u001b[90;3m<界界>\u001b[39;23m  Fields.  \u001b[90m(required,\u001b[39m \u001b[90mrepeatable,\u001b[39m \u001b[93mdeprecated: Use new.\u001b[90m)\u001b[39m\n',
  );
  expect(result.stdout).toContain(
    '      \u001b[33m--mode\u001b[39m \u001b[90;3m<mode>\u001b[39;23m   Literal default.  \u001b[90m(default: \uE001red\uE002x\uE003)\u001b[39m\n',
  );
  expect(result.stdout).toContain('      \u001b[33m--[no-]cache\u001b[39m\n');
  expect(result.stdout).toContain(
    '  \u001b[33m-x\u001b[39m \u001b[90;3m<é>\u001b[39;23m              Short.\n',
  );
  expect(result.stdout).toContain('  \u001b[90;3m界\u001b[39;23m  Wide.\n');
});

test('a deprecated routed Command highlights only the deprecation line as warning', () => {
  expect(
    run({ argv: ['get', '--help'], rendering: { color: 'always', modifiers: 'always' } }).stdout,
  ).toBe(
    [
      '\u001b[33;1mapp get\u001b[39;22m \u001b[90m·\u001b[39m Read one.',
      '  \u001b[93mDeprecated: Use read.\u001b[39m',
      '',
      '\u001b[90mUSAGE\u001b[39m',
      '  \u001b[33mapp get\u001b[39m \u001b[90;3m[options]\u001b[39;23m',
      '',
      '\u001b[90mGLOBAL OPTIONS\u001b[39m',
      '  \u001b[33m-h\u001b[90m,\u001b[39m \u001b[33m--help\u001b[39m     Show this help.',
      '  \u001b[33m-V\u001b[90m,\u001b[39m \u001b[33m--version\u001b[39m  Print the version.',
      '',
    ].join('\n'),
  );
});

// These are literal terminal codes from the palette contract, independent of Loom's style helpers.
function terminal(code: string, text: string, reset = '39'): string {
  return code === '' ? text : `\u001b[${code}m${text}\u001b[${reset}m`;
}

test.each([
  {
    dim: '90',
    highlight: '33',
    modifiers: true,
    options: { rendering: { color: 'always', modifiers: 'always' } },
    primary: '',
  },
  {
    dim: '38;5;245',
    highlight: '38;5;172',
    modifiers: true,
    options: {
      env: { TERM: 'xterm-256color' },
      rendering: { color: 'always', modifiers: 'always' },
    },
    primary: '',
  },
  {
    dim: '38;2;139;147;163',
    highlight: '38;2;201;123;54',
    modifiers: true,
    options: {
      env: { COLORTERM: 'truecolor' },
      rendering: { color: 'always', modifiers: 'always' },
    },
    primary: '',
  },
  {
    dim: '35',
    highlight: '36',
    modifiers: true,
    options: { rendering: { color: 'always', modifiers: 'always' }, theme: 'custom' },
    primary: '32',
  },
  {
    dim: '',
    highlight: '',
    modifiers: true,
    options: { rendering: { color: 'always', modifiers: 'always' }, theme: 'absent' },
    primary: '',
  },
  {
    dim: '',
    highlight: '',
    modifiers: true,
    options: { env: { NO_COLOR: '1' }, tty: true },
    primary: '',
  },
  { dim: '', highlight: '', modifiers: false, options: {}, primary: '' },
  {
    dim: '',
    highlight: '',
    modifiers: false,
    options: { rendering: { color: 'never', modifiers: 'never' }, tty: true },
    primary: '',
  },
  {
    dim: '90',
    highlight: '33',
    modifiers: false,
    options: { rendering: { color: 'always', modifiers: 'never' } },
    primary: '',
  },
])(
  'help resolves the theme and modifier policy without changing layout: $options',
  ({ options, highlight, dim, primary, modifiers }) => {
    const bold = [highlight, modifiers ? '1' : ''].filter(Boolean).join(';');
    const italic = [dim, modifiers ? '3' : ''].filter(Boolean).join(';');
    const boldReset = [highlight ? '39' : '', modifiers ? '22' : ''].filter(Boolean).join(';');
    const italicReset = [dim ? '39' : '', modifiers ? '23' : ''].filter(Boolean).join(';');
    const helpShort = highlight ? `\u001b[${highlight}m-h\u001b[${dim}m,\u001b[39m` : '-h,';
    const versionShort = highlight ? `\u001b[${highlight}m-V\u001b[${dim}m,\u001b[39m` : '-V,';
    expect(run({ ...options, argv: ['--help'], minimal: true })).toEqual({
      status: 0,
      stderr: '',
      stdout: [
        terminal(bold, 'app', boldReset),
        '',
        terminal(dim, 'USAGE'),
        `  ${terminal(highlight, 'app')} ${terminal(italic, '[options]', italicReset)}`,
        '',
        terminal(dim, 'OPTIONS'),
        `  ${helpShort} ${terminal(highlight, '--help')}     ${terminal(primary, 'Show this help.')}`,
        `  ${versionShort} ${terminal(highlight, '--version')}  ${terminal(primary, 'Print the version.')}`,
        '',
      ].join('\n'),
    });
  },
);

test('a detailed custom theme distinguishes every page token, including primary prose and examples', () => {
  expect(
    run({ argv: ['--help'], rendering: { color: 'always', modifiers: 'always' }, theme: 'custom' }),
  ).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '\u001b[36;1mapp\u001b[39;22m \u001b[35m·\u001b[39m \u001b[32mRead values.\u001b[39m',
      '',
      '  \u001b[32mOne line.\u001b[39m',
      '',
      '\u001b[35mUSAGE\u001b[39m',
      '  \u001b[36mapp\u001b[39m \u001b[35;3m[options]\u001b[39;23m',
      '  \u001b[36mapp\u001b[39m \u001b[35;3m<command>\u001b[39;23m \u001b[35;3m[options]\u001b[39;23m',
      '',
      '\u001b[35mCOMMANDS\u001b[39m',
      '  \u001b[36mget\u001b[39m  \u001b[32mRead one.\u001b[39m  \u001b[35m(\u001b[31mdeprecated: Use read.\u001b[35m)\u001b[39m',
      '',
      '\u001b[35mGLOBAL OPTIONS\u001b[39m',
      '  \u001b[36m-h\u001b[35m,\u001b[39m \u001b[36m--help\u001b[39m     \u001b[32mShow this help.\u001b[39m',
      '  \u001b[36m-V\u001b[35m,\u001b[39m \u001b[36m--version\u001b[39m  \u001b[32mPrint the version.\u001b[39m',
      '',
      '\u001b[35mEXAMPLES\u001b[39m',
      '  \u001b[35m$\u001b[39m \u001b[36mapp\u001b[39m \u001b[32mget --raw «warning»\u001b[39m',
      '    \u001b[35mLiteral flags.\u001b[39m',
      '',
      '\u001b[35mRun\u001b[39m \u001b[36mapp\u001b[39m \u001b[35;3m<command>\u001b[39;23m \u001b[36m--help\u001b[39m \u001b[35mfor command details.\u001b[39m',
      '',
    ].join('\n'),
  });
});
