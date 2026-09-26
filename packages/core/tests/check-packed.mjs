import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const typescript = require('typescript/package.json');
const compiler = join(dirname(require.resolve('typescript/package.json')), typescript.bin.tsc);
const { version } = require('../package.json');
const packageManager = process.env.npm_execpath;
assert.ok(packageManager, 'Run this check through pnpm run check:packed.');

// A runtime name selects an executable, the way the process tests select one.
const runtimes = new Map([
  ['bun', 'bun'],
  ['node', process.execPath],
]);
const requested = process.env.LOOM_TEST_RUNTIME ?? '';
const selected = requested === '' ? [...runtimes.keys()] : [requested];
for (const name of selected) {
  assert.ok(runtimes.has(name), `LOOM_TEST_RUNTIME accepts node or bun, not "${name}".`);
}

/** The help page the packed plugins render, written by hand from the page rules. */
const page = [
  'greeter · Greet one subject.',
  '',
  '  The greeting is printed before the subject.',
  '',
  'USAGE',
  '  greeter <subject> [options]',
  '',
  'ARGUMENTS',
  '  subject  Who to greet. Any name.',
  '',
  'OPTIONS',
  '  -g, --greeting <word>  The greeting to print.  (default: hello)',
  '  -h, --help             Show this help.',
  '  -V, --version          Print the version.',
  '',
  'EXAMPLES',
  '  $ greeter world --greeting packed',
  '    The line this check compares.',
  '',
].join('\n');

// Fixed invocations, so the printed bytes are the whole contract the packed packages satisfy.
const styledPage = [
  '\u001b[33;1mgreeter\u001b[39;22m \u001b[90m·\u001b[39m Greet one subject.',
  '',
  '  The greeting is printed before the subject.',
  '',
  '\u001b[90mUSAGE\u001b[39m',
  '  \u001b[33mgreeter\u001b[39m \u001b[90;3m<subject>\u001b[39;23m \u001b[90;3m[options]\u001b[39;23m',
  '',
  '\u001b[90mARGUMENTS\u001b[39m',
  '  \u001b[90;3msubject\u001b[39;23m  Who to greet. Any name.',
  '',
  '\u001b[90mOPTIONS\u001b[39m',
  '  \u001b[33m-g\u001b[90m,\u001b[39m \u001b[33m--greeting\u001b[39m \u001b[90;3m<word>\u001b[39;23m  The greeting to print.  \u001b[90m(default: hello)\u001b[39m',
  '  \u001b[33m-h\u001b[90m,\u001b[39m \u001b[33m--help\u001b[39m             Show this help.',
  '  \u001b[33m-V\u001b[90m,\u001b[39m \u001b[33m--version\u001b[39m          Print the version.',
  '',
  '\u001b[90mEXAMPLES\u001b[39m',
  '  \u001b[90m$\u001b[39m \u001b[33mgreeter\u001b[39m world --greeting packed',
  '    \u001b[90mThe line this check compares.\u001b[39m',
  '',
].join('\n');
const invocations = [
  {
    argv: ['--help'],
    env: { LOOM_PACKED_STYLES: '1' },
    expected: `greeter help\n${styledPage}`,
    reads: 'the themed help page',
  },
  {
    argv: ['--version'],
    env: { LOOM_PACKED_STYLES: '1' },
    expected: 'greeter build\n\u001b[33;1mgreeter\u001b[39;22m v1.0.0\n',
    reads: 'the themed version line',
  },
  {
    argv: ['world', '--greeting', 'packed'],
    expected: 'packed: world\n',
    reads: 'the action line',
  },
  // The consumer overrides both declared views the packed plugins publish.
  // Each branded line proves the registry resolved through the installed tarballs.
  { argv: ['--help'], expected: `greeter help\n${page}`, reads: 'the overridden help page' },
  {
    argv: ['--version'],
    expected: 'greeter build\ngreeter v1.0.0\n',
    reads: 'the overridden version line',
  },
];

function run(command, args, cwd, env = {}) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} received ${result.signal}`);
  return { output: result.stdout + result.stderr, status: result.status, stdout: result.stdout };
}

function pnpm(args, cwd) {
  let command = packageManager;
  let commandArgs = args;
  if (/\.[cm]?js$/.test(packageManager)) {
    command = process.execPath;
    commandArgs = [packageManager, ...args];
  }
  const result = run(command, commandArgs, cwd);
  assert.equal(result.status, 0, result.output);
}

const source = fileURLToPath(new URL('runtime-consumer', import.meta.url));
const temporary = await mkdtemp(join(tmpdir(), 'loom-runtime-consumer-'));
try {
  pnpm(['pack', '--out', join(temporary, 'core.tgz')], join(root, 'packages/core'));
  pnpm(['pack', '--out', join(temporary, 'plugins.tgz')], join(root, 'packages/plugins'));
  pnpm(['pack', '--out', join(temporary, 'validators.tgz')], join(root, 'packages/validators'));
  await cp(source, temporary, { recursive: true });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@loomcli/core': 'file:./core.tgz',
        '@loomcli/plugins': 'file:./plugins.tgz',
        '@loomcli/validators': 'file:./validators.tgz',
      },
      private: true,
      type: 'module',
    }),
  );
  pnpm(['install', '--prefer-offline', '--ignore-scripts', '--lockfile=false'], temporary);

  // JavaScript emit proves the consumer runs what it compiled, not what a loader interpreted.
  const compiled = run(
    process.execPath,
    [compiler, '-p', 'tsconfig.json', '--pretty', 'false'],
    temporary,
  );
  assert.equal(compiled.status, 0, compiled.output);

  // Compile the reusable library first, outside the application's registration program.
  for (const project of ['library', 'registered']) {
    const result = run(
      process.execPath,
      [compiler, '-p', 'tsconfig.json', '--pretty', 'false'],
      join(temporary, project),
    );
    assert.equal(result.status, 0, result.output);
  }
  const registered = join(temporary, 'registered-dist/main.js');
  for (const name of selected) {
    for (const { argv, env, expected } of [
      { argv: ['greet', 'world', '--trace'], expected: 'hello: world\n' },
      { argv: ['local', '--trace'], expected: 'true\n' },
      { argv: ['local'], expected: 'false\n' },
      { argv: ['styled'], env: { TERM: 'xterm-256color' }, expected: '◉ ok        :4\n' },
    ]) {
      const result = run(runtimes.get(name), [registered, ...argv], temporary, env);
      assert.equal(result.status, 0, result.output);
      assert.equal(result.stdout, expected);
    }
    const result = run(runtimes.get(name), [registered, 'greet', '--help'], temporary);
    assert.equal(result.status, 0, result.output);
    assert.match(result.stdout, /Application details\./);
    assert.doesNotMatch(result.stdout, /Library details|greet old/);
  }
  const paletteExpected = [
    'primary|\x1b[90mdim\x1b[39m|\x1b[33mhighlight\x1b[39m|\x1b[32msuccess\x1b[39m|\x1b[93mwarning\x1b[39m|\x1b[31merror\x1b[39m|\x1b[34minfo\x1b[39m|\x1b[32mrgb\x1b[39m|\x1b[32mindexed\x1b[39m|\x1b[42mbgHex\x1b[49m|\x1b[42mbgRgb\x1b[49m|\x1b[42mbgIndexed\x1b[49m',
    'primary|\x1b[38;5;245mdim\x1b[39m|\x1b[38;5;172mhighlight\x1b[39m|\x1b[38;5;108msuccess\x1b[39m|\x1b[38;5;178mwarning\x1b[39m|\x1b[38;5;131merror\x1b[39m|\x1b[38;5;67minfo\x1b[39m|\x1b[38;5;108mrgb\x1b[39m|\x1b[38;5;108mindexed\x1b[39m|\x1b[48;5;108mbgHex\x1b[49m|\x1b[48;5;108mbgRgb\x1b[49m|\x1b[48;5;108mbgIndexed\x1b[49m',
    'primary|\x1b[38;2;139;147;163mdim\x1b[39m|\x1b[38;2;201;123;54mhighlight\x1b[39m|\x1b[38;2;122;143;123msuccess\x1b[39m|\x1b[38;2;226;185;61mwarning\x1b[39m|\x1b[38;2;192;69;50merror\x1b[39m|\x1b[38;2;91;125;163minfo\x1b[39m|\x1b[38;2;122;143;123mrgb\x1b[39m|\x1b[38;5;108mindexed\x1b[39m|\x1b[48;2;122;143;123mbgHex\x1b[49m|\x1b[48;2;122;143;123mbgRgb\x1b[49m|\x1b[48;5;108mbgIndexed\x1b[49m',
    '\x1b[34mbare\x1b[39m\n',
  ].join('');
  for (const name of selected) {
    const result = run(runtimes.get(name), [join(temporary, 'dist/palette.js')], temporary);
    assert.equal(result.status, 0, result.output);
    assert.equal(result.stdout, paletteExpected, `${name}: packed palette and fallback output`);
  }
  const collectedExpected =
    '[{"details":"Only an agent needs this."},{"examples":[{"command":"read x"}]}]\n';
  for (const name of selected) {
    const result = run(runtimes.get(name), [join(temporary, 'dist/manifest.js')], temporary);
    assert.equal(result.status, 0, result.output);
    const [collected, ...document] = result.stdout.split('\n');
    assert.equal(`${collected}\n`, collectedExpected, `${name}: packed manifest values`);
    const printed = JSON.parse(document.join('\n'));
    assert.deepEqual(
      {
        details: printed.command.details,
        examples: printed.command.examples,
        name: printed.command.name,
      },
      {
        details: ['Only an agent needs this.'],
        examples: [{ command: 'read x', note: null }],
        name: 'read',
      },
      `${name}: packed manifest document`,
    );
  }
  const validators = join(temporary, 'dist/validators.js');
  for (const name of selected) {
    const accepted = run(
      runtimes.get(name),
      [validators, '--port', '443', '--mode', 'prod', '--tag', 'a', '--tag', 'b'],
      temporary,
    );
    assert.equal(accepted.status, 0, accepted.output);
    assert.equal(
      accepted.stdout,
      '{"listen":443,"mode":"prod","tags":["a","b"]}\n',
      `${name}: packed validators output`,
    );
    const rejected = run(
      runtimes.get(name),
      [validators, '--workers', '0', '--tag', ''],
      temporary,
    );
    assert.equal(rejected.status, 2, rejected.output);
    assert.equal(
      rejected.output,
      'Invalid input: Option "--workers": Expected a whole number from 1 through 64.\nOption "--tag" at 0: Expected from 1 through 8 characters.\n',
      `${name}: packed validators rejection`,
    );
  }
  // The packed configuration plugin reads the named file, then the user file the name derives.
  const configured = join(temporary, 'dist/config.js');
  await writeFile(join(temporary, 'settings.json'), '{ "greeting": { "word": "named" } }');
  const xdg = join(temporary, 'xdg');
  await mkdir(join(xdg, 'packed-config'), { recursive: true });
  await writeFile(
    join(xdg, 'packed-config', 'config.json'),
    '{ "greeting": { "word": "configured" } }',
  );
  for (const name of selected) {
    const named = run(runtimes.get(name), [configured, '--config', 'settings.json'], temporary);
    assert.equal(named.status, 0, named.output);
    assert.equal(named.stdout, 'named\n', `${name}: packed configuration from the named file`);
    const user = run(runtimes.get(name), [configured], temporary, { XDG_CONFIG_HOME: xdg });
    assert.equal(user.status, 0, user.output);
    assert.equal(user.stdout, 'configured\n', `${name}: packed configuration from the user file`);
  }
  const entry = join(temporary, 'dist/main.js');
  for (const name of selected) {
    for (const { argv, expected, reads, env } of invocations) {
      const runtime = run(runtimes.get(name), [entry, ...argv], temporary, env);
      assert.equal(runtime.status, 0, `${name} exited with ${runtime.status}: ${runtime.output}`);
      assert.equal(
        runtime.stdout,
        expected,
        `${name} printed unexpected bytes for ${reads}: ${runtime.output}`,
      );
    }
  }
  process.stdout.write(
    `Packed @loomcli/core, @loomcli/plugins, and @loomcli/validators ${version}: ${selected.join(' and ')} ran the installed tarballs and printed ${invocations.length} expected outputs, the action line, the overridden help page, the overridden version line, the collected manifest values, the manifest document, the validated and rejected options, and the configured word from the named file and the user file.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
