import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL('../../../', import.meta.url));
const typescript = require('typescript/package.json');
const compiler = join(dirname(require.resolve('typescript/package.json')), typescript.bin.tsc);
const { version } = typescript;
const zod = require('zod/package.json');
const { devDependencies } = require('../../../package.json');
const packageManager = process.env.npm_execpath;
assert.ok(packageManager, 'Run this check through pnpm run check:types.');

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, encoding: 'utf8' });
  assert.ifError(result.error);
  assert.equal(result.signal, null, `${command} received ${result.signal}`);
  return { output: result.stdout + result.stderr, status: result.status };
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

// Declaration emit proves a consumer can publish its own types for exported declarations.
async function compile(cwd, keep = false) {
  const result = run(process.execPath, [compiler, '-p', 'tsconfig.json', '--pretty', 'false'], cwd);
  if (!keep) {
    await rm(join(cwd, 'dist'), { force: true, recursive: true });
  }
  return result;
}

/** The authoring skill's Markdown, whose `ts` blocks each compile as a module of their own. */
const skillFolder = join(root, 'packages/loom/skills/loom');

/** Every Markdown file under a folder, as absolute paths in a stable order. */
async function markdownUnder(folder) {
  const entries = await readdir(folder, { withFileTypes: true });
  const found = [];
  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name))) {
    if (entry.isDirectory()) {
      found.push(...(await markdownUnder(join(folder, entry.name))));
    } else if (entry.name.endsWith('.md')) {
      found.push(join(folder, entry.name));
    }
  }
  return found;
}

/**
 * The blocks fenced `ts` in a Markdown text, each with the 1-based line its first code line stands
 * on. A block ends at the next line that closes its fence.
 */
function tsBlocks(text) {
  const blocks = [];
  let open = undefined;
  for (const [index, line] of text.split('\n').entries()) {
    if (open === undefined) {
      const fence = /^(?<fence>`{3,})ts\s*$/u.exec(line)?.groups?.fence;
      if (fence !== undefined) {
        open = { code: [], fence, line: index + 2 };
      }
    } else if (new RegExp(`^${open.fence}\\s*$`, 'u').test(line)) {
      blocks.push({ code: `${open.code.join('\n')}\n`, line: open.line });
      open = undefined;
    } else {
      open.code.push(line);
    }
  }
  return blocks;
}

/**
 * Writes each `ts` block of the authoring skill to a module of its own in a folder, and answers
 * where each came from, by the module's file name.
 */
async function writeSkillExamples(folder) {
  const origins = new Map();
  for (const file of await markdownUnder(skillFolder)) {
    const blocks = tsBlocks(await readFile(file, 'utf8'));
    for (const [index, block] of blocks.entries()) {
      const name = `example-${String(origins.size + 1).padStart(3, '0')}.ts`;
      await writeFile(join(folder, name), block.code);
      const markdown = relative(root, file);
      origins.set(name, `${markdown}, block ${index + 1} (line ${block.line})`);
    }
  }
  assert.ok(origins.size > 0, 'The authoring skill holds no ts blocks to compile.');
  return origins;
}

const source = fileURLToPath(new URL('type-consumer', import.meta.url));
const projects = [
  'library',
  '.',
  'registered',
  'styles',
  'spellings',
  'states',
  'nested-states',
  'validate-omitted',
  'scaffold-tsconfig',
];
for (const project of projects) {
  const workspace = await compile(join(source, project), project === 'library');
  assert.equal(workspace.status, 0, `${project}: ${workspace.output}`);
}

const temporary = await mkdtemp(join(tmpdir(), 'loom-type-consumer-'));
try {
  const coreTarball = join(temporary, 'core.tgz');
  const pluginsTarball = join(temporary, 'plugins.tgz');
  const promptsTarball = join(temporary, 'prompts.tgz');
  const validatorsTarball = join(temporary, 'validators.tgz');
  const testingTarball = join(temporary, 'testing.tgz');
  pnpm(['pack', '--out', coreTarball], join(root, 'packages/core'));
  pnpm(['pack', '--out', pluginsTarball], join(root, 'packages/plugins'));
  pnpm(['pack', '--out', promptsTarball], join(root, 'packages/prompts'));
  pnpm(['pack', '--out', validatorsTarball], join(root, 'packages/validators'));
  pnpm(['pack', '--out', testingTarball], join(root, 'packages/testing'));
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
        // The authoring skill's examples import bun:test, whose types a consumer installs too.
        '@types/bun': devDependencies['@types/bun'],
        // A consumer installs its own Node types, which core's declarations type-check against.
        '@types/node': devDependencies['@types/node'],
        // The authoring skill's examples import a test runner, vitest or bun:test.
        vitest: devDependencies.vitest,
        zod: zod.version,
      },
      private: true,
      type: 'module',
    }),
  );
  await writeFile(
    join(temporary, 'pnpm-workspace.yaml'),
    `overrides:\n  '@loomcli/validators': 'file:${validatorsTarball}'\n`,
  );
  pnpm(['install', '--prefer-offline', '--ignore-scripts', '--lockfile=false'], temporary);
  // Invalid augmentation cannot silently erase globals, including with skipLibCheck enabled.
  const invalid = join(temporary, 'invalid-registration');
  await mkdir(invalid);
  for (const skipLibCheck of [false, true]) {
    await writeFile(
      join(invalid, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: { module: 'NodeNext', noEmit: true, skipLibCheck, strict: true },
        include: ['*.ts'],
      }),
    );
    await writeFile(
      join(invalid, 'invalid.ts'),
      `import { Command } from '@loomcli/core';
declare module '@loomcli/core' { interface Register { environment: string; } }
new Command('invalid').action(() => {});
`,
    );
    const rejected = await compile(invalid);
    assert.notEqual(rejected.status, 0, 'Invalid registration compiled.');
    // The compiler reports the fault once, on the first declaration of the merged interface.
    // With library checking on, that is the package's own `Register`, in `environment.d.ts`.
    // With it off, that is the augmentation itself, the declaration the consumer wrote.
    const site = skipLibCheck
      ? /invalid\.ts\(2,\d+\): error TS2430:/
      : /environment\.d\.ts\(\d+,\d+\): error TS2430:/;
    assert.match(rejected.output, site);
  }
  for (const { source: content, diagnostic } of [
    {
      diagnostic: /circular|own type annotation/,
      source: `import { Application, Command } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
const configured = new Application('app').globalOption('quiet', { type: 'boolean' });
const read = new Command('read').action(({ options }) => options.quiet);
const app = configured.command(read);
declare module '@loomcli/core' { interface Register { environment: EnvironmentOf<typeof app>; } }
`,
    },
    {
      diagnostic: /TS7022|TS2502/,
      source: `import { Command } from '@loomcli/core';
import type { ActionHandler } from '@loomcli/core';
const handler: ActionHandler<typeof read> = () => {};
const read = new Command('read').action(handler).extend();
`,
    },
  ]) {
    await writeFile(join(invalid, 'invalid.ts'), content);
    const rejected = await compile(invalid);
    assert.notEqual(rejected.status, 0, 'A circular registration or action anchor compiled.');
    assert.match(rejected.output, diagnostic);
  }
  // The authoring skill's examples compile against the packed libraries, one module for each block.
  const examples = join(temporary, 'skill-examples');
  await mkdir(examples);
  const origins = await writeSkillExamples(examples);
  await writeFile(
    join(examples, 'tsconfig.json'),
    JSON.stringify({
      compilerOptions: {
        module: 'NodeNext',
        moduleDetection: 'force',
        moduleResolution: 'NodeNext',
        noEmit: true,
        skipLibCheck: true,
        strict: true,
        target: 'ES2022',
        // TypeScript 7 loads no @types package that a configuration does not list.
        types: ['bun', 'node'],
      },
      include: ['*.ts'],
    }),
  );
  const compiled = await compile(examples);
  let report = compiled.output;
  for (const [name, origin] of origins) {
    report = report.replaceAll(name, origin);
  }
  assert.equal(compiled.status, 0, `The authoring skill's examples do not compile:\n${report}`);
  let rejectedCount = 0;
  for (const project of projects) {
    const directory = join(temporary, project);
    const packed = await compile(directory, project === 'library');
    assert.equal(packed.status, 0, `${project}: ${packed.output}`);

    const originals = new Map();
    const expected = [];
    const files = await readdir(directory);
    for (const file of files.filter((entry) => entry.endsWith('.ts'))) {
      const path = join(directory, file);
      const contents = await readFile(path, 'utf8');
      originals.set(path, contents);
      const lines = contents.split('\n');
      for (let index = 0; index < lines.length; index += 1) {
        const directive = /@ts-expect-error TS(?<code>\d+):/.exec(lines[index]);
        if (directive) {
          const { code } = directive.groups;
          expected.push(`${file}:${index + 2}:TS${code}`);
          lines[index] = '';
        }
      }
      await writeFile(path, lines.join('\n'));
    }
    assert.ok(expected.length > 0, 'No negative declaration assertions found.');
    const negative = await compile(directory, project === 'library');
    assert.notEqual(negative.status, 0, 'Invalid SDK uses unexpectedly compiled.');
    const actual = [
      ...negative.output.matchAll(/(?<file>[^\n]+)\((?<line>\d+),\d+\): error TS(?<code>\d+):/g),
    ].map(({ groups: { file, line, code } }) => `${basename(file)}:${line}:TS${code}`);
    assert.deepEqual(actual.toSorted(), expected.toSorted(), negative.output);
    for (const [path, contents] of originals) {
      await writeFile(path, contents);
    }
    if (project === 'library') {
      const restored = await compile(directory, true);
      assert.equal(restored.status, 0, restored.output);
    }
    rejectedCount += expected.length;
  }
  process.stdout.write(
    `TypeScript ${version}: workspace and packed declarations passed; ${rejectedCount} rejected SDK uses produced the expected diagnostics.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
