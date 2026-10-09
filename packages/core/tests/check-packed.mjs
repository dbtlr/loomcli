import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
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
  });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} received ${result.signal}`);
  return { output: result.stdout + result.stderr, status: result.status, stdout: result.stdout };
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
  pnpm(['pack', '--out', join(temporary, 'loom.tgz')], join(root, 'packages/loom'));
  // Publint fails each tarball on any warning, such as a nested manifest's exports map.
  for (const name of ['core', 'plugins', 'validators', 'loom']) {
    pnpm(['exec', 'publint', '--strict', join(temporary, `${name}.tgz`)], root);
  }
  // Attw resolves each export's declarations under the module settings an ESM-only package serves.
  // The toolchain ships only its bin and exports no module, so it has no export to resolve.
  for (const name of ['core', 'plugins', 'validators']) {
    pnpm(['exec', 'attw', join(temporary, `${name}.tgz`), '--profile', 'esm-only'], root);
  }
  // The packed manifest must pin core at the synchronized version itself.
  // The override below would hide an unrewritten workspace spec that no registry consumer resolves.
  const loomManifest = run('tar', ['-xzOf', 'loom.tgz', 'package/package.json'], temporary);
  assert.equal(loomManifest.status, 0, loomManifest.output);
  const loomPackage = JSON.parse(loomManifest.stdout);
  const loomCore = loomPackage.dependencies?.['@loomcli/core'];
  assert.equal(
    loomCore,
    version,
    `The packed @loomcli/loom must depend on @loomcli/core ${version}, not "${loomCore}".`,
  );
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
  await cp(source, temporary, { recursive: true });
  await writeFile(
    join(temporary, 'package.json'),
    JSON.stringify({
      dependencies: {
        '@loomcli/core': 'file:./core.tgz',
        '@loomcli/plugins': 'file:./plugins.tgz',
        '@loomcli/validators': 'file:./validators.tgz',
      },
      // Rolldown bundles the plain fixture below, at the version the repository pins.
      devDependencies: { '@loomcli/loom': 'file:./loom.tgz', rolldown: devDependencies.rolldown },
      private: true,
      type: 'module',
    }),
  );
  // The packed toolchain depends on core at the synchronized version.
  // The override resolves it to the packed core, so the check never reads core from the registry.
  await writeFile(
    join(temporary, 'pnpm-workspace.yaml'),
    "overrides:\n  '@loomcli/core': 'file:./core.tgz'\n",
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
  const homes = { HOME: home, USERPROFILE: home };
  for (const name of selected) {
    const named = run(runtimes.get(name), [configured, '-c', 'settings.toml'], temporary, homes);
    assert.equal(named.status, 0, named.output);
    assert.equal(named.stdout, 'named\n', `${name}: packed configuration from the named file`);
    const found = run(runtimes.get(name), [configured], temporary, homes);
    assert.equal(found.status, 0, found.output);
    assert.equal(found.stdout, 'configured\n', `${name}: packed configuration from the home file`);
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
      ['2026-07-28'],
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
  // The packed loom bin checks an application module against the packed core and finds no fault.
  await writeFile(
    join(temporary, 'checked.ts'),
    "import { Application } from '@loomcli/core';\n\nexport const checked = new Application('checked', { description: 'Checked by the packed loom.' }).action(() => undefined);\n",
  );
  const applicationCheck = run(
    join(temporary, 'node_modules/.bin/loom'),
    ['check', '--application', 'checked.ts'],
    temporary,
  );
  assert.equal(applicationCheck.status, 0, applicationCheck.output);
  assert.equal(applicationCheck.stdout, '', 'the packed loom check prints nothing on stdout');
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
  // Core reads no file at run time, so any bundler bundles an application without a define.
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
  process.stdout.write(
    `Packed @loomcli/core, @loomcli/plugins, @loomcli/validators, and @loomcli/loom ${version}: ${selected.join(' and ')} linted the four tarballs with publint and attw, ran the installed tarballs, and printed ${invocations.length} expected outputs, the action line, the overridden help page in both variants, the overridden version line, the collected manifest values, the manifest document, the validated and rejected options, the configured word from the named TOML file and the home YAML file, the three completion scripts, an MCP session from a pack that lists no protocol dependency, a suggestion, the loom bin checking a package's fragments, the loom bin checking an application module, a fixture the loom bin bundled that reads distributed while its source reads source, and a fixture Bun and Rolldown bundled with no define that measures text and reads source.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
