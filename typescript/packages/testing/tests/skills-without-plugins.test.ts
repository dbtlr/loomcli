import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test } from 'vite-plus/test';

import { childEnvironment } from '../../../scripts/test-process.js';

/*
 * The assertion reaches `@loomcli/plugins/skills` through an import that resolves from the testing
 * package's own files, so each case installs the built testing package into a sandbox project
 * beside a stand-in plugins package, or beside none, and runs the assertion there. A process proves
 * it, because the resolution is the runtime's, and the cases run under Node and under Bun alike.
 */
const testingDist = fileURLToPath(new URL('../dist', import.meta.url));
const corePackage = fileURLToPath(new URL('../../core', import.meta.url));

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

const check = `import { Application } from '@loomcli/core';
import { assertAssembles, assertSkillsMatch } from '@loomcli/testing';
const application = new Application('notes', { description: 'Notes.' }).action(() => {});
assertAssembles(application);
try { await assertSkillsMatch(application, '.'); process.exitCode = 2; }
catch (error) { console.error(error); process.exitCode = 1; }
`;

/*
 * Module resolution has no ceiling, so a sandbox whose `TMPDIR` sits inside a checkout lets the
 * lookup for `@loomcli/plugins` climb to the checkout's own `node_modules`, and the missing-plugins
 * case would find a plugins package. Node and Bun share no resolution hook, and Node's
 * `import.meta.resolve` does not check that a mapped file exists, so no stand-in can read as
 * missing. The sandbox goes under the first base whose ancestors hold no plugins package instead.
 */
function holdsPlugins(directory: string): boolean {
  const parent = dirname(directory);
  return (
    existsSync(join(directory, 'node_modules/@loomcli/plugins')) ||
    (parent !== directory && holdsPlugins(parent))
  );
}

function sandboxBase(): string {
  const base = [tmpdir(), '/tmp', homedir()].find((candidate) => !holdsPlugins(candidate));
  if (base === undefined) {
    throw new Error('No directory outside every @loomcli/plugins installation can hold a sandbox');
  }
  return base;
}

/** A project that installs the testing package and core, and the plugins stand-in when one is given. */
function project(plugins: string | undefined): string {
  const root = mkdtempSync(join(sandboxBase(), 'loom-testing-companion-'));
  roots.push(root);
  const scope = join(root, 'node_modules/@loomcli');
  mkdirSync(join(scope, 'testing'), { recursive: true });
  cpSync(testingDist, join(scope, 'testing/dist'), { recursive: true });
  writeFileSync(
    join(scope, 'testing/package.json'),
    `${JSON.stringify({ exports: './dist/index.js', name: '@loomcli/testing', type: 'module' })}\n`,
  );
  symlinkSync(corePackage, join(scope, 'core'), 'dir');
  if (plugins !== undefined) {
    mkdirSync(join(scope, 'plugins'));
    writeFileSync(
      join(scope, 'plugins/package.json'),
      `${JSON.stringify({ exports: { './skills': './skills.js' }, name: '@loomcli/plugins', type: 'module' })}\n`,
    );
    writeFileSync(join(scope, 'plugins/skills.js'), plugins);
  }
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ type: 'module' })}\n`);
  writeFileSync(join(root, 'check.mjs'), check);
  return root;
}

test.each([
  {
    name: 'no plugins package',
    plugins: undefined,
    sentence: 'Install @loomcli/plugins beside @loomcli/testing',
  },
  {
    name: 'a plugins package that exports no skillFolders',
    plugins: 'export const other = true;\n',
    sentence: 'Install @loomcli/plugins and @loomcli/testing at one version',
  },
  {
    name: 'a plugins package whose skillFolders answers in another shape',
    plugins: 'export function skillFolders() { return [{}]; }\n',
    sentence: 'Install @loomcli/plugins and @loomcli/testing at one version',
  },
  {
    name: 'a plugins package that throws while it loads',
    plugins: 'throw new Error("evaluation failed");\n',
    sentence: 'evaluation failed',
  },
  {
    name: 'a plugins package that imports a file it lacks',
    plugins: 'import "./absent-part.js";\nexport function skillFolders() { return undefined; }\n',
    sentence: 'absent-part.js',
  },
])('the optional plugins package: $name', ({ plugins, sentence }) => {
  const root = project(plugins);
  const result = spawnSync(process.execPath, ['check.mjs'], {
    cwd: root,
    encoding: 'utf8',
    env: childEnvironment(),
    timeout: 30_000,
  });
  expect(result.stderr).toContain(sentence);
  // Only a package that does not resolve is reported as missing.
  expect(result.stderr.includes('Install @loomcli/plugins beside @loomcli/testing')).toBe(
    plugins === undefined,
  );
  expect(result.status).toBe(1);
});
