import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const typescript = require('typescript/package.json');
const compiler = join(dirname(require.resolve('typescript/package.json')), typescript.bin.tsc);
const { version } = require('../package.json');
const { devDependencies } = require('../../../package.json');
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
/** The compact page `-h` prints: the page without the details and EXAMPLES, and a pointer to them. */
const compactPage = [
  'greeter · Greet one subject.',
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
  'Run greeter --help for details and examples.',
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
    argv: ['-h'],
    expected: `greeter help -h\n${compactPage}`,
    reads: 'the compact help page, whose variant the core spelling selected',
  },
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
    maxBuffer: 256 * 1024 * 1024,
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} received ${result.signal}`);
  return {
    output: result.stdout + result.stderr,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

/** The start and end of a long output, so a failing check names its cause without a flood. */
function excerpt(output) {
  return output.length <= 6000 ? output : `${output.slice(0, 3000)}\n...\n${output.slice(-3000)}`;
}

/**
 * The pnpm workspace file that resolves every first-party package a packed package depends on to
 * its tarball in the directory, so an install never reads a package of the synchronized version
 * from the registry, where a release cut's version is not yet published.
 */
function workspaceOverrides(directory) {
  const names = ['core', 'eslint-plugin', 'plugins', 'prompts', 'testing', 'validators'];
  return `overrides:\n${names
    .map((name) => `  '@loomcli/${name}': 'file:${join(directory, `${name}.tgz`)}'\n`)
    .join('')}`;
}

/** The scaffolds `loom init` writes in an empty directory: the defaults, and the other pair. */
const scaffolds = [
  { args: [], label: 'oxlint-bun', linter: 'oxlint' },
  {
    args: ['--linter', 'eslint', '--test-runner', 'vitest'],
    label: 'eslint-vitest',
    linter: 'eslint',
  },
];

/**
 * Scaffolds an application with the packed `loom init`, installs it from the packed tarballs, and
 * requires its `check` script to pass under Bun. Then it adds an undescribed option to the
 * application and requires the linter to fail naming the `@loomcli/undescribed` rule, which proves
 * the linter loads the packed lint plugin.
 */
async function checkScaffold(temporary, { args, label, linter }) {
  const directory = join(temporary, 'scaffolds', label, 'notes');
  await mkdir(directory, { recursive: true });
  const initialized = run(join(temporary, 'node_modules/.bin/loom'), ['init', ...args], directory);
  assert.equal(initialized.status, 0, `${label}: ${initialized.output}`);
  // The scaffold pins the synchronized version, so each first-party package installs from its tarball.
  const manifestPath = join(directory, 'package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const group of ['dependencies', 'devDependencies']) {
    for (const name of Object.keys(manifest[group] ?? {})) {
      if (name.startsWith('@loomcli/')) {
        manifest[group][name] = `file:${join(temporary, `${name.slice('@loomcli/'.length)}.tgz`)}`;
      }
    }
  }
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(join(directory, 'pnpm-workspace.yaml'), workspaceOverrides(temporary));
  pnpm(['install', '--prefer-offline', '--ignore-scripts', '--lockfile=false'], directory);
  // The compiler the scaffold's `tsc` runs is TypeScript 7 beside an ESLint scaffold's TypeScript 6.
  const version7 = run(join(directory, 'node_modules/.bin/tsc'), ['--version'], directory);
  assert.match(version7.stdout, /^Version 7\./u, `${label}: tsc is not TypeScript 7`);
  const checked = run('bun', ['run', 'check'], directory);
  assert.equal(
    checked.status,
    0,
    `${label}: the scaffold's check script failed:\n${excerpt(checked.output)}`,
  );
  const applicationPath = join(directory, 'src/application.ts');
  const application = await readFile(applicationPath, 'utf8');
  const undescribed = application.replace(
    '}).action(',
    "}).option('verbose', { type: 'boolean' }).action(",
  );
  assert.notEqual(undescribed, application, `${label}: the scaffold's application changed shape`);
  await writeFile(applicationPath, undescribed);
  const linted = run(
    join(directory, 'node_modules/.bin', linter),
    linter === 'oxlint' ? ['src'] : ['.'],
    directory,
  );
  assert.notEqual(
    linted.status,
    0,
    `${label}: ${linter} passed an undescribed option:\n${excerpt(linted.output)}`,
  );
  assert.match(
    linted.output,
    /@loomcli.undescribed/u,
    `${label}: ${linter} did not name the undescribed rule:\n${excerpt(linted.output)}`,
  );
}

/** The `_meta` every request of the MCP revision the packed plugin speaks carries. */
const mcpMeta = {
  'io.modelcontextprotocol/clientCapabilities': {},
  'io.modelcontextprotocol/protocolVersion': '2026-07-28',
};

/**
 * One MCP session with a packed application: each request is written once the answer to the one
 * before it arrives, so a tool call is answered before stdin ends, and then stdin ends. Resolves
 * with every message the server wrote, its stderr, and its exit status.
 */
function mcpSession(command, args, cwd, requests) {
  const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], timeout: 10_000 });
  let stdout = '';
  let stderr = '';
  let sent = 0;
  const sendNext = () => {
    const next = requests[sent];
    sent += 1;
    if (next === undefined) {
      child.stdin.end();
    } else {
      child.stdin.write(
        `${JSON.stringify({ ...next, jsonrpc: '2.0', params: { ...next.params, _meta: mcpMeta } })}\n`,
      );
    }
  };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
    while (stdout.split('\n').length - 1 >= sent && sent <= requests.length) {
      sendNext();
    }
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  sendNext();
  return new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (status) => {
      const messages = stdout
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line));
      resolve({ messages, status, stderr });
    });
  });
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
  pnpm(['pack', '--out', join(temporary, 'prompts.tgz')], join(root, 'packages/prompts'));
  pnpm(['pack', '--out', join(temporary, 'testing.tgz')], join(root, 'packages/testing'));
  pnpm(
    ['pack', '--out', join(temporary, 'eslint-plugin.tgz')],
    join(root, 'packages/eslint-plugin'),
  );
  pnpm(['pack', '--out', join(temporary, 'loom.tgz')], join(root, 'packages/loom'));
  // Publint fails each tarball on any warning, such as a nested manifest's exports map.
  for (const name of [
    'core',
    'plugins',
    'validators',
    'prompts',
    'testing',
    'eslint-plugin',
    'loom',
  ]) {
    pnpm(['exec', 'publint', '--strict', join(temporary, `${name}.tgz`)], root);
  }
  // Attw resolves each export's declarations under the module settings an ESM-only package serves.
  // The toolchain ships only its bin and exports no module, so it has no export to resolve.
  for (const name of ['core', 'plugins', 'validators', 'prompts', 'testing', 'eslint-plugin']) {
    pnpm(['exec', 'attw', join(temporary, `${name}.tgz`), '--profile', 'esm-only'], root);
  }
  // The packed manifest must pin each first-party dependency at the synchronized version itself.
  // The overrides below would hide an unrewritten workspace spec that no registry consumer resolves.
  const loomManifest = run('tar', ['-xzOf', 'loom.tgz', 'package/package.json'], temporary);
  assert.equal(loomManifest.status, 0, loomManifest.output);
  const loomPackage = JSON.parse(loomManifest.stdout);
  for (const name of [
    '@loomcli/core',
    '@loomcli/eslint-plugin',
    '@loomcli/plugins',
    '@loomcli/prompts',
    '@loomcli/validators',
  ]) {
    const pinned = loomPackage.dependencies?.[name];
    assert.equal(
      pinned,
      version,
      `The packed @loomcli/loom must depend on ${name} ${version}, not "${pinned}".`,
    );
  }
  // The toolchain exports no ./build subpath; the build bakes the release facts through a define.
  assert.equal(
    loomPackage.exports?.['./build'],
    undefined,
    'The packed @loomcli/loom exports ./build.',
  );
  // The toolchain ships its commands as the loom bin.
  assert.deepEqual(
    loomPackage.bin,
    { loom: 'dist/main.js' },
    'The packed @loomcli/loom must declare the loom bin.',
  );
  // The plugin pack inlines the private MCP protocol package, so no consumer installs it.
  const pluginsManifest = run('tar', ['-xzOf', 'plugins.tgz', 'package/package.json'], temporary);
  assert.equal(pluginsManifest.status, 0, pluginsManifest.output);
  const { dependencies = {}, peerDependencies = {} } = JSON.parse(pluginsManifest.stdout);
  for (const [field, listed] of Object.entries({ dependencies, peerDependencies })) {
    assert.ok(
      !Object.hasOwn(listed, '@loom/mcp'),
      `The packed @loomcli/plugins must not list @loom/mcp under ${field}.`,
    );
  }
  // No built file names the private package either, so no module or declaration imports it.
  // The manifest keeps it as a development dependency, which no consumer installs.
  const pluginsFiles = join(temporary, 'plugins-files');
  await mkdir(pluginsFiles);
  const unpacked = run('tar', ['-xzf', 'plugins.tgz', '-C', pluginsFiles], temporary);
  assert.equal(unpacked.status, 0, unpacked.output);
  const pluginsBuild = join(pluginsFiles, 'package/dist');
  const builtFiles = await readdir(pluginsBuild, { recursive: true, withFileTypes: true });
  const naming = [];
  for (const entry of builtFiles.filter((file) => file.isFile())) {
    const path = join(entry.parentPath, entry.name);
    const text = await readFile(path, 'utf8');
    if (text.includes('@loom/mcp')) {
      naming.push(relative(pluginsBuild, path));
    }
  }
  assert.deepEqual(naming, [], 'No built file of the packed @loomcli/plugins may name @loom/mcp.');
  await cp(source, temporary, { recursive: true });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@loomcli/core': 'file:./core.tgz',
        '@loomcli/plugins': 'file:./plugins.tgz',
        '@loomcli/prompts': 'file:./prompts.tgz',
        '@loomcli/testing': 'file:./testing.tgz',
        '@loomcli/validators': 'file:./validators.tgz',
        // The packed configuration consumer describes its file with a schema.
        zod: devDependencies.zod,
      },
      // Rolldown bundles the plain fixture below, at the version the repository pins.
      devDependencies: { '@loomcli/loom': 'file:./loom.tgz', rolldown: devDependencies.rolldown },
      private: true,
      type: 'module',
    }),
  );
  // The packed toolchain depends on core, the plugin pack, the prompts, and the lint plugin at the
  // Synchronized version. The overrides resolve them to the packed tarballs, so the check never
  // Reads any from the registry, where a release cut's version is not yet published.
  await writeFile(join(temporary, 'pnpm-workspace.yaml'), workspaceOverrides(temporary));
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
  for (const name of selected) {
    const grouped = run(runtimes.get(name), [join(temporary, 'dist/option-groups.js')], temporary);
    assert.equal(grouped.status, 0, grouped.output);
    assert.equal(grouped.stderr, '');
    assert.deepEqual(JSON.parse(grouped.stdout), {
      accepted: 'completed',
      groups: [
        { kind: 'exclusive', options: ['json', 'yaml'] },
        { kind: 'oneRequired', options: ['json', 'yaml'] },
      ],
      rejected: {
        exitCode: 2,
        problems: [
          {
            inputs: [
              { global: false, kind: 'option', name: 'json' },
              { global: false, kind: 'option', name: 'yaml' },
            ],
            reason: 'exclusive',
            spellings: ['json', 'yaml'],
            supplied: ['json', 'yaml'],
          },
        ],
      },
    });
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
        manifestShort: printed.globals.find((option) => option.name === 'manifest').short,
        name: printed.command.name,
      },
      {
        details: ['Only an agent needs this.'],
        examples: [{ command: 'read x', note: null }],
        manifestShort: '-M',
        name: 'read',
      },
      `${name}: packed manifest document`,
    );
  }
  const groupedRoot = [
    'grouped',
    '',
    'USAGE',
    '  grouped <command> [options]',
    '',
    'WORK',
    '  READ',
    '    read  Read work.',
    '  EDIT',
    '    edit  Edit work.',
    '',
    'OUTPUT',
    '  -q, --quiet  Say less.',
    '',
    'GLOBAL OPTIONS',
    '  -h, --help  Show this help.',
    '',
  ];
  const groupedLeaf = [
    'grouped read · Read work.',
    '',
    'USAGE',
    '  grouped read [options]',
    '',
    'OUTPUT',
    '  -f, --format <format>  Select the format.',
    '  -q, --quiet            Say less.',
    '',
    'GLOBAL OPTIONS',
    '  -h, --help  Show this help.',
    '',
  ].join('\n');
  for (const name of selected) {
    const grouped = join(temporary, 'dist/help-sections.js');
    for (const spelling of ['--help', '-h']) {
      const result = run(runtimes.get(name), [grouped, spelling], temporary);
      assert.equal(result.status, 0, result.output);
      assert.equal(
        result.stdout,
        [...groupedRoot, `Run grouped <command> ${spelling} for command details.`, ''].join('\n'),
        `${name}: packed grouped ${spelling} page`,
      );
    }
    const result = run(runtimes.get(name), [grouped, 'read', '--help'], temporary);
    assert.equal(result.status, 0, result.output);
    assert.equal(
      result.stdout,
      groupedLeaf,
      `${name}: packed combined local/global option section`,
    );
  }
  for (const name of selected) {
    const accepted = run(
      runtimes.get(name),
      [join(temporary, 'dist/prompts.js'), '--port', '443'],
      temporary,
    );
    assert.equal(accepted.status, 0, accepted.output);
    assert.equal(accepted.stdout, '443\n', `${name}: packed linked prompt`);
    assert.equal(accepted.stderr, '', `${name}: skipped prompt is silent`);
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
      'validators: Option "--workers": Expected a whole number from 1 through 64.\nvalidators: Option "--tag" at 0: Expected from 1 through 8 characters.\n',
      `${name}: packed validators rejection`,
    );
  }
  // The packed configuration plugin reads the named TOML file, then the YAML file in the home directory.
  // Each format proves its parser package installed beside the packed pack.
  const configured = join(temporary, 'dist/config.js');
  await writeFile(join(temporary, 'settings.toml'), '[greeting]\nword = "named"\n');
  const home = join(temporary, 'home');
  await mkdir(home, { recursive: true });
  await writeFile(join(home, '.packed-config.yaml'), 'greeting:\n  word: configured\n');
  const homes = { HOME: home };
  for (const name of selected) {
    const named = run(runtimes.get(name), [configured, '-c', 'settings.toml'], temporary, homes);
    assert.equal(named.status, 0, named.output);
    assert.equal(named.stdout, 'named\n', `${name}: packed configuration from the named file`);
    const found = run(runtimes.get(name), [configured], temporary, homes);
    assert.equal(found.status, 0, found.output);
    assert.equal(found.stdout, 'configured\n', `${name}: packed configuration from the home file`);
  }
  // The packed dotenv export fills an option and publishes only the argv run's additions.
  await writeFile(join(temporary, '.env'), 'LOOM_PACKED_DOTENV_TOKEN=packed\nIGNORED=other\n');
  for (const name of selected) {
    const result = run(runtimes.get(name), [join(temporary, 'dist/dotenv.js')], temporary, {
      LOOM_PACKED_DOTENV_TOKEN: undefined,
    });
    assert.equal(result.status, 0, result.output);
    assert.equal(result.stderr, '', `${name}: packed dotenv warnings`);
    const [named, argv] = result.stdout
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      named,
      {
        messages: '',
        output: '{"env":"packed","process":null,"value":"packed"}\n',
        status: 'completed',
      },
      `${name}: packed dotenv named invocation`,
    );
    assert.deepEqual(
      argv,
      { env: 'packed', process: 'packed', value: 'packed' },
      `${name}: packed dotenv argv`,
    );
  }
  // The packed completion plugin prints each shell's script for the application's name.
  const completing = join(temporary, 'dist/completion.js');
  for (const name of selected) {
    for (const [shell, first] of [
      ['bash', '# Bash completion script, printed by the Loom completion plugin.\n'],
      ['zsh', '#compdef packed-completion\n'],
      ['fish', '# Fish completion script, printed by the Loom completion plugin.\n'],
    ]) {
      const printed = run(runtimes.get(name), [completing, 'completion', shell], temporary);
      assert.equal(printed.status, 0, printed.output);
      assert.ok(printed.stdout.startsWith(first), `${name}: packed ${shell} script first line`);
      assert.ok(
        printed.stdout.includes('packed_2d_completion'),
        `${name}: packed ${shell} script function identifier`,
      );
    }
  }
  // The packed MCP plugin serves a session: discovery, the listing, and one call through invoke.
  const serving = join(temporary, 'dist/mcp.js');
  const serverInfo = { name: 'packed-mcp', version: '1.0.0' };
  for (const name of selected) {
    const session = await mcpSession(runtimes.get(name), [serving, 'mcp'], temporary, [
      { id: 1, method: 'server/discover', params: {} },
      { id: 2, method: 'tools/list', params: {} },
      {
        id: 3,
        method: 'tools/call',
        params: { arguments: { subject: 'world' }, name: 'greet' },
      },
    ]);
    assert.deepEqual(
      { status: session.status, stderr: session.stderr },
      { status: 0, stderr: '' },
      `${name}: the packed MCP session ended`,
    );
    assert.deepEqual(
      session.messages.map((message) => message.id),
      [1, 2, 3],
      `${name}: the packed MCP session answered each request`,
    );
    const [discovered, listed, called] = session.messages;
    assert.deepEqual(
      discovered.result.supportedVersions,
      ['2026-07-28', '2025-11-25', '2025-06-18'],
      `${name}: packed discovery`,
    );
    assert.deepEqual(
      listed.result.tools,
      [
        {
          annotations: { readOnlyHint: true },
          description: 'Greet one subject.',
          inputSchema: {
            additionalProperties: false,
            properties: { subject: { description: 'The name to greet.', type: 'string' } },
            required: ['subject'],
            type: 'object',
          },
          name: 'greet',
        },
      ],
      `${name}: the packed MCP listing`,
    );
    assert.deepEqual(
      called.result,
      {
        _meta: { 'io.modelcontextprotocol/serverInfo': serverInfo },
        content: [{ text: 'hello: world\n', type: 'text' }],
        isError: false,
        resultType: 'complete',
      },
      `${name}: the packed MCP call`,
    );
  }
  // The packed suggestions plugin offers the near match as the fix inside the sentence.
  const suggesting = join(temporary, 'dist/suggestions.js');
  for (const name of selected) {
    const suggested = run(runtimes.get(name), [suggesting, 'gte'], temporary);
    assert.equal(suggested.status, 2, suggested.output);
    assert.equal(
      suggested.output,
      'packed-suggestions: Unknown command "gte". Did you mean "get"?\n',
      `${name}: packed suggestion`,
    );
  }
  // The packed testing package runs an Application on a mock process and reads what it wrote.
  const mocking = join(temporary, 'dist/mock-process.js');
  for (const name of selected) {
    const mocked = run(runtimes.get(name), [mocking], temporary);
    assert.equal(mocked.status, 0, mocked.output);
    assert.equal(mocked.output, '0 0 got /packed\n', `${name}: packed mockProcess run`);
  }
  // The packed color plugin's --color turns color on for piped output, which is plain without it.
  const coloring = join(temporary, 'dist/color.js');
  for (const name of selected) {
    const chosen = run(runtimes.get(name), [coloring, '--color'], temporary);
    assert.equal(chosen.status, 0, chosen.output);
    assert.equal(chosen.output, '\u001b[31mred\u001b[39m\n', `${name}: packed --color`);
    const unchosen = run(runtimes.get(name), [coloring], temporary);
    assert.equal(unchosen.output, 'red\n', `${name}: packed run without a choice`);
  }
  // The packed background plugin's --background settles the run's background, and none leaves it unknown.
  const shading = join(temporary, 'dist/background.js');
  for (const name of selected) {
    const chosen = run(runtimes.get(name), [shading, '--background=light'], temporary);
    assert.equal(chosen.output, 'light\n', `${name}: packed --background=light`);
    const unchosen = run(runtimes.get(name), [shading], temporary);
    assert.equal(unchosen.output, 'undefined\n', `${name}: packed run without a background`);
  }
  // The packed verbose plugin's -vv reveals the debug and trace lines, and -q hides info.
  const verbosity = join(temporary, 'dist/verbose.js');
  for (const name of selected) {
    const loud = run(runtimes.get(name), [verbosity, '-vv'], temporary);
    assert.equal(loud.status, 0, loud.output);
    assert.equal(loud.stderr, '› debug\n  ┆ trace\nℹ info\n', `${name}: packed -vv`);
    const quiet = run(runtimes.get(name), [verbosity, '-q'], temporary);
    assert.equal(quiet.output, '', `${name}: packed -q`);
  }
  // The packed logging plugin appends one record to the file under the state directory it is given.
  const logged = join(temporary, 'dist/logging.js');
  for (const name of selected) {
    const state = join(temporary, `state-${name}`);
    const written = run(runtimes.get(name), [logged], temporary, { XDG_STATE_HOME: state });
    assert.equal(written.status, 0, written.output);
    assert.equal(written.output, 'failures:0\n', `${name}: packed logging run`);
    const file = await readFile(join(state, 'packed-logging', 'packed-logging.jsonl'), 'utf8');
    const records = file
      .trimEnd()
      .split('\n')
      .map((line) => JSON.parse(line));
    assert.equal(records.length, 1, `${name}: packed logging wrote one record`);
    assert.deepEqual(
      records.map(({ level, message, fields, plugin }) => ({ fields, level, message, plugin })),
      [
        {
          fields: { count: 3 },
          level: 'info',
          message: 'Logged from the packed plugin.',
          plugin: null,
        },
      ],
      `${name}: packed logging record`,
    );
  }
  // The packed self-update plugin refuses a run that is not a release binary, before any request.
  const updating = join(temporary, 'dist/self-update.js');
  for (const name of selected) {
    const refused = run(runtimes.get(name), [updating], temporary);
    assert.equal(refused.status, 1, refused.output);
    assert.equal(
      refused.output,
      'packed-update was not built as a release binary, so it cannot update itself. Update it the way you installed it.\n',
      `${name}: packed self-update refusal`,
    );
  }
  // The packed service plugin refuses a platform with neither manager, before it runs anything.
  const servicing = join(temporary, 'dist/service.js');
  for (const name of selected) {
    const refused = run(runtimes.get(name), [servicing], temporary);
    assert.equal(refused.status, 1, refused.output);
    assert.equal(
      refused.output,
      'packed-service cannot run a service on win32. Run it on Linux with systemd or macOS with launchd.\n',
      `${name}: packed service refusal`,
    );
  }
  // The packed skills plugin refuses a relative HOME, before it loads a skill or reads the record.
  const skilling = join(temporary, 'dist/skills.js');
  for (const name of selected) {
    const refused = run(runtimes.get(name), [skilling], temporary);
    assert.equal(refused.status, 1, refused.output);
    assert.equal(
      refused.output,
      'packed-skills cannot find your home folder because HOME is not an absolute path. Set HOME to an absolute path, then run the command again.\n',
      `${name}: packed skills refusal`,
    );
  }
  // The packed manpage plugin generates the page set into a folder.
  const paging = join(temporary, 'dist/manpage.js');
  for (const name of selected) {
    const generated = run(runtimes.get(name), [paging], temporary);
    assert.equal(generated.status, 0, generated.output);
    assert.equal(
      generated.output,
      '8 pages\n.TH "PACKED\\-MAN\\-GREET" "1" "" "packed\\-man 1.0.0" ""\n',
      `${name}: packed man pages`,
    );
  }
  // The packed resolver gives the state and cache rows and names the relative HOME darwin needs.
  const directories = `${JSON.stringify([
    { path: join('/state', 'notes', 'installation') },
    { variable: 'HOME' },
    { path: join('/state', 'notes') },
    { variable: 'HOME' },
    { path: join('/cache', 'notes') },
    { variable: 'HOME' },
  ])}\n`;
  for (const name of selected) {
    const resolved = run(runtimes.get(name), [join(temporary, 'dist/directory.js')], temporary);
    assert.equal(resolved.status, 0, resolved.output);
    assert.equal(resolved.output, directories, `${name}: packed applicationDirectory`);
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
  // The packed loom bin bundles the release facts probe, baking a distributed build's release facts
  // Into the packed core, and the bundle reads them under each runtime and writes the generic message.
  const bundled = run(
    join(temporary, 'node_modules/.bin/loom'),
    ['build', '--target', 'node', '--entry', 'release.ts', '--out', 'release-dist'],
    temporary,
  );
  assert.equal(bundled.status, 0, bundled.output);
  // A text import is bundled by the installed toolchain and renders under either runtime.
  const markdownSource = fileURLToPath(new URL('fixtures/markdown', import.meta.url));
  await cp(markdownSource, join(temporary, 'markdown'), { recursive: true });
  const markdownBuild = run(
    join(temporary, 'node_modules/.bin/loom'),
    ['build', '--target', 'node', '--entry', 'markdown/main.ts', '--out', 'markdown-dist'],
    temporary,
  );
  assert.equal(markdownBuild.status, 0, markdownBuild.output);
  // Removing the source proves the bundle carries the imported file's text.
  await rm(join(temporary, 'markdown'), { recursive: true });
  const markdownPage = [
    'markdown · Read Markdown Details.',
    '',
    '  Read values',
    '  ───────────',
    '',
    '  ● Read a key, such as `user.name`.',
    '  ● See the format (https://www.json.org/json-en.html).',
    '',
    '    app get user.name',
    '',
    'USAGE',
    '  markdown [options]',
    '',
    'OPTIONS',
    '  -h, --help  Show this help.',
    '',
  ].join('\n');
  for (const name of selected) {
    const result = run(
      runtimes.get(name),
      [join(temporary, 'markdown-dist/main.js'), '--help'],
      temporary,
    );
    assert.equal(result.status, 0, result.output);
    assert.equal(
      result.stdout,
      markdownPage,
      `${name}: packed Markdown Details from a text import`,
    );
  }
  const releaseBundle = join(temporary, 'release-dist/release.js');
  for (const name of selected) {
    const built = run(runtimes.get(name), [releaseBundle, 'build'], temporary);
    assert.equal(built.status, 0, built.output);
    assert.equal(built.stdout, 'distributed\n', `${name}: the packed bundle's release facts`);
    const failed = run(runtimes.get(name), [releaseBundle, 'fail'], temporary);
    assert.equal(failed.status, 1, failed.output);
    assert.equal(
      failed.output,
      'release-probe: Something went wrong.\n',
      `${name}: the packed bundle's defect`,
    );
  }
  // Core carries its Unicode tables as a module, so any bundler bundles an application without a define.
  // Each bundle measures text with the packed Unicode tables, reads source, and so writes the
  // Developer Diagnostic for a defect.
  const plainSource = fileURLToPath(new URL('fixtures/bundled', import.meta.url));
  await cp(plainSource, join(temporary, 'bundled'), { recursive: true });
  const measured = [
    '日本  |',
    'e\u0301     |',
    '👩\u200d💻    |',
    '🇯🇵    |',
    'abc   |',
    'source',
    '',
  ].join('\n');
  for (const [bundler, builder] of [
    ['bun', 'bun'],
    ['rolldown', process.execPath],
  ]) {
    const outdir = join(temporary, 'plain-dist', bundler);
    const plain = run(builder, [join(temporary, 'bundled/bundle.mjs'), bundler, outdir], temporary);
    assert.equal(plain.status, 0, plain.output);
    for (const name of selected) {
      const measuring = run(runtimes.get(name), [join(outdir, 'main.js'), 'measure'], temporary);
      assert.equal(measuring.status, 0, measuring.output);
      assert.equal(measuring.stdout, measured, `${name}: the packed bundle ${bundler} built`);
      const failed = run(runtimes.get(name), [join(outdir, 'main.js'), 'fail'], temporary);
      assert.equal(failed.status, 1, failed.output);
      assert.match(
        failed.output,
        /^-- UNHANDLED EXCEPTION -+ @loomcli\/core\/foreign-throw\n\nThe bundle failed\.\n/u,
        `${name}: the packed bundle ${bundler} built reports a defect to its author`,
      );
    }
  }
  // The installed loom bin checks the fragments of the package it runs in.
  // It runs through the linked shim and under each runtime.
  const notes = join(temporary, 'notes');
  await mkdir(join(notes, '.changes'), { recursive: true });
  await writeFile(join(notes, 'package.json'), '{"name":"notes","version":"1.4.7"}\n');
  await writeFile(join(notes, '.changes/README.md'), '# Change fragments\n');
  await writeFile(join(notes, '.changes/feature.tags.md'), '- Add tags.\n');
  await writeFile(join(notes, '.changes/output.md'), '- Fix output.\n');
  const linked = run(join(temporary, 'node_modules/.bin/loom'), ['changelog', 'check'], notes);
  assert.equal(linked.status, 0, linked.output);
  assert.equal(
    linked.stdout,
    'Checked 2 fragments.\n',
    'the linked loom bin checked the fragments',
  );
  const bin = join(temporary, 'node_modules/@loomcli/loom', loomPackage.bin.loom);
  for (const name of selected) {
    const checked = run(runtimes.get(name), [bin, 'changelog', 'check'], notes);
    assert.equal(checked.status, 0, checked.output);
    assert.equal(checked.stdout, 'Checked 2 fragments.\n', `${name}: the packed loom bin checked`);
  }
  // The probe's source, and its compile that no bundler baked, read source.
  for (const [runtime, file] of [
    ['bun', 'release.ts'],
    [process.execPath, 'dist/release.js'],
  ]) {
    const sourced = run(runtime, [join(temporary, file), 'build'], temporary);
    assert.equal(sourced.status, 0, sourced.output);
    assert.equal(sourced.stdout, 'source\n', `${file}: the unbundled release facts`);
  }
  // Each scaffold the packed loom bin writes installs from the packed tarballs and passes its own
  // Check script under Bun: the type check, the linter, and the assembly test.
  for (const scaffold of scaffolds) {
    await checkScaffold(temporary, scaffold);
  }
  process.stdout.write(
    `Packed @loomcli/core, @loomcli/plugins, @loomcli/validators, @loomcli/prompts, @loomcli/testing, @loomcli/eslint-plugin, and @loomcli/loom ${version}: ${selected.join(' and ')} linted the seven tarballs with publint and the declarations of the six libraries with attw, ran the installed tarballs, and printed ${invocations.length} expected outputs, the action line, the overridden help page in both variants, the overridden version line, the collected manifest values, the manifest document, the validated and rejected options, a supplied linked prompt, declared option groups with structured failures, dotenv values in argv and named runs, the configured word from the named TOML file and the home YAML file, the three completion scripts, an MCP session from a pack that lists no protocol dependency, a suggestion, a run on a mock process, a color choice, a background choice, a verbosity, a log record appended under the state directory, a self-update refusal, a service refusal, a skills refusal, the generated man pages, the installation, log, and cache directories applicationDirectory resolves, the loom bin checking a package's fragments, ${scaffolds.length} scaffolds the loom bin wrote that passed their own check script and, with oxlint and with ESLint, failed on an undescribed option, Markdown Details imported as text and rendered from a packed loom bundle, a fixture the loom bin bundled that reads distributed while its source reads source, and a fixture Bun and Rolldown bundled with no define that measures text and reads source.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
