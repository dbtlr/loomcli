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
const pluginsManifest = require('../../plugins/package.json');
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

const exampleFolders = [
  'packages/loom/skills/loom',
  'docs/core',
  'docs/plugins',
  'docs/libs',
  'docs/toolchain',
];

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
 * The lines of a page that open a TypeScript fence `tsBlocks` does not read: one inside a list item
 * or a block quote, indented four spaces or more, fenced with tildes, separated from its tag by a
 * space, or tagged `typescript`, `tsx`, `mts`, or `cts`, in any letter case. Such a block would be skipped without a word, so the check names it instead.
 */
function strayFences(text) {
  const stray = [];
  let close = undefined;
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    // A fence inside another fenced block, such as a doc comment's example, is that block's text.
    if (close === undefined) {
      if (isUnreadTypeScriptFence(line)) {
        stray.push(index + 1);
      }
      const margin = /^ {0,3}(?<marks>`{3,}|~{3,})/u.exec(line);
      if (margin) {
        const { marks } = margin.groups;
        close = new RegExp(`^ {0,3}${marks}${marks[0]}*\\s*$`, 'u');
      }
    } else if (close.test(line)) {
      close = undefined;
    }
  }
  return stray;
}

/** Whether a line opens a TypeScript fence that `tsBlocks` does not read. */
function isUnreadTypeScriptFence(line) {
  const fence =
    /^(?<lead>[\s>]*(?:(?:[-*+]|\d+[.)])\s+)?)(?<marks>`{3,}|~{3,})(?<gap>\s*)(?<tag>[A-Za-z]+)?(?<rest>.*)$/u.exec(
      line,
    );
  if (
    !fence ||
    !['cts', 'mts', 'ts', 'tsx', 'typescript'].includes((fence.groups.tag ?? '').toLowerCase())
  ) {
    return false;
  }
  const { gap, lead, marks, rest, tag } = fence.groups;
  const read =
    /^ {0,3}$/u.test(lead) &&
    marks.startsWith('`') &&
    gap === '' &&
    tag === 'ts' &&
    /^(?: sketch)?\s*$/u.test(rest);
  return !read;
}

function tsBlocks(text) {
  const blocks = [];
  let number = 0;
  let open = undefined;
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (open === undefined) {
      const match = /^(?<indent> {0,3})(?<fence>`{3,}|~{3,})(?<info>.*)$/u.exec(line);
      if (match) {
        const { fence, indent, info } = match.groups;
        const backticks = fence.startsWith('`');
        if (!backticks || !info.includes('`')) {
          const tag = info.trimEnd();
          open = { block: undefined, close: new RegExp(`^ {0,3}${fence}${fence[0]}*\\s*$`, 'u') };
          if (backticks && (tag === 'ts' || tag === 'ts sketch')) {
            number += 1;
            if (tag === 'ts') {
              open.block = { code: [], indent: indent.length, line: index + 2, number };
              blocks.push(open.block);
            }
          }
        }
      }
    } else if (open.close.test(line)) {
      open = undefined;
    } else if (open.block !== undefined) {
      const leading = /^ */u.exec(line)[0].length;
      open.block.code.push(line.slice(Math.min(open.block.indent, leading)));
    }
  }
  return blocks;
}

function exampleFiles(lines, origin) {
  const files = [];
  const marker = /^\/\/ (?<path>(?:[\w-][\w.-]*\/)*[\w-][\w.-]*\.(?:[cm]?ts|json))\s*$/u;
  if (!marker.test(lines[0] ?? '')) {
    return [{ lines, offset: 0, path: 'example.ts' }];
  }
  for (const [index, line] of lines.entries()) {
    const path = marker.exec(line)?.groups.path;
    if (path === undefined) {
      files.at(-1).lines.push(line);
    } else {
      assert.ok(!files.some((file) => file.path === path), `${origin} repeats the file ${path}.`);
      files.push({ lines: [], offset: index + 1, path });
    }
  }
  return files;
}

const exampleCompilerOptions = {
  module: 'NodeNext',
  moduleDetection: 'force',
  moduleResolution: 'NodeNext',
  noEmit: true,
  skipLibCheck: true,
  strict: true,
  target: 'ES2022',
  // TypeScript 7 loads no @types package that a configuration does not list.
  types: ['bun', 'node'],
};

async function compileExamples(folder, pages) {
  const projects = new Map();
  let count = 0;
  for (const page of pages) {
    const markdown = relative(root, page);
    const text = await readFile(page, 'utf8');
    const stray = strayFences(text);
    if (stray.length > 0) {
      throw new Error(
        `${markdown}:${stray[0]}: check:types reads only a \`\`\`ts fence at the margin. Write the example as one, or mark it \`\`\`ts sketch.`,
      );
    }
    const blocks = tsBlocks(text);
    for (const block of blocks) {
      const { number } = block;
      const files = exampleFiles(block.code, `${markdown}, block ${number} (line ${block.line})`);
      const name = `example-${++count}`;
      // An augmentation or a declaration script can change the types seen by other examples.
      const isolated = files.some(
        ({ lines, path }) =>
          /\.d\.[cm]?ts$/u.test(path) ||
          /\bdeclare\s+(?:global\b|module\s+['"])/u.test(lines.join('\n')),
      );
      const project = isolated ? join(folder, name) : join(folder, 'shared');
      const directory = join(project, isolated ? 'files' : name);
      if (!projects.has(project)) {
        projects.set(project, new Map());
      }
      const origins = projects.get(project);
      for (const file of files) {
        const path = join(directory, file.path);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, `${file.lines.join('\n')}\n`);
        origins.set(relative(project, path), { block, file, markdown, number });
      }
    }
  }

  assert.ok(count > 0, 'No ts examples to compile.');
  let output = '';
  let status = 0;
  for (const [project, origins] of projects) {
    await writeFile(
      join(project, 'tsconfig.json'),
      JSON.stringify({
        compilerOptions: exampleCompilerOptions,
        include: ['**/*.ts', '**/*.mts', '**/*.cts'],
      }),
    );
    const result = await compile(project);
    status ||= result.status;
    output += result.output.replaceAll(
      /^(?<path>.+)\((?<line>\d+),(?<column>\d+)\):/gmu,
      (site, path, line, column) => {
        const origin = origins.get(path);
        if (origin === undefined) {
          return site;
        }
        const { block, file, markdown, number } = origin;
        const markdownLine = block.line + file.offset + Number(line) - 1;
        return `${markdown}:${markdownLine}:${column} (block ${number}, starts at line ${block.line}):`;
      },
    );
  }
  return { count, output, status };
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
  'fifty',
  'fifty-registered',
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
        '@opentelemetry/api-logs': pluginsManifest.devDependencies['@opentelemetry/api-logs'],
        // The authoring skill's examples import bun:test, whose types a consumer installs too.
        '@types/bun': devDependencies['@types/bun'],
        // A consumer installs its own Node types, which core's declarations type-check against.
        '@types/node': devDependencies['@types/node'],
        valibot: pluginsManifest.dependencies.valibot,
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
  const fixturePage = join(root, 'packages/core/tests/fixtures/type-examples.md');
  const rejectedExample = await compileExamples(join(temporary, 'example-fixture'), [fixturePage]);
  assert.notEqual(rejectedExample.status, 0, 'A broken bare ts block compiled.');
  assert.equal(rejectedExample.count, 2, 'The fixture should compile both bare ts blocks.');
  const fixtureErrors = rejectedExample.output
    .split('\n')
    .filter((line) => line.includes(': error TS'));
  assert.equal(fixtureErrors.length, 1, rejectedExample.output);
  assert.match(
    fixtureErrors[0],
    /packages\/core\/tests\/fixtures\/type-examples\.md:27:\d+ \(block 3, starts at line 22\): error TS2322:/,
  );

  // A TypeScript fence the scanner cannot read is named, not skipped.
  for (const [stray, line] of [
    ['1. Step\n\n    ```ts\n    const n: number = 1;\n    ```\n', 3],
    ['- ```ts\n  const n: number = 1;\n  ```\n', 1],
    ['> ```ts\n> const n: number = 1;\n> ```\n', 1],
    ['~~~ts\nconst n: number = 1;\n~~~\n', 1],
    ['```typescript\nconst n: number = 1;\n```\n', 1],
    ['```tsx\nconst n = 1;\n```\n', 1],
    ['``` ts\nconst n: number = 1;\n```\n', 1],
    ['```TS\nconst n: number = 1;\n```\n', 1],
    ['```TypeScript\nconst n: number = 1;\n```\n', 1],
    ['```mts\nconst n: number = 1;\n```\n', 1],
    ['```cts\nconst n: number = 1;\n```\n', 1],
  ]) {
    assert.deepEqual(strayFences(stray), [line], stray);
  }
  assert.deepEqual(
    strayFences('```ts\nconst n = 1;\n```\n\n```ts sketch\nf();\n```\n   ```ts\nx;\n   ```\n'),
    [],
  );

  const pages = await Promise.all(
    exampleFolders.map((folder) => markdownUnder(join(root, folder))),
  );
  const compiled = await compileExamples(join(temporary, 'examples'), pages.flat());
  assert.equal(compiled.status, 0, `The Markdown examples do not compile:\n${compiled.output}`);
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
    `TypeScript ${version}: workspace and packed declarations passed; ${compiled.count} Markdown examples compiled; ${rejectedCount} rejected SDK uses produced the expected diagnostics.\n`,
  );
} finally {
  await rm(temporary, { force: true, recursive: true });
}
