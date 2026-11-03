/*
 * Jsonkit's built bundle loads each first-party plugin Command's work only when that Command runs.
 * Each case starts the bundle `pnpm build:examples` writes in a fresh process under Node, because
 * only a fresh process has not yet evaluated a module, and reads which plugin modules it loaded.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The built bundle, started behind the hook that records each file of it the run loads. */
const launch = new URL('fixtures/launch.mjs', import.meta.url);

/** The plugin modules Bun writes above each module's code, by path under the plugins' `src`. */
const pluginModule = /^\/\/ (?:\.\.\/)*packages\/plugins\/dist\/src\/(?<path>\S+\.js)$/gmu;

/** The folders whose modules hold the completion, manpage, and MCP plugins and the files they install. */
const watched = ['completion/', 'manpage/', 'mcp/', 'installation/'];

/**
 * One run of the bundle: its exit status and output, the set of watched plugin modules it loaded,
 * and whether it loaded `node:crypto`.
 */
function launched(args: string[]) {
  const directory = mkdtempSync(join(tmpdir(), 'loom-jsonkit-launch-'));
  const marks = join(directory, 'marks.txt');
  try {
    const result = invoke(launch, args, {
      env: { HOME: directory, LOOM_FIXTURE_MARKS: marks },
      runtime: 'node',
    });
    const lines = readFileSync(marks, 'utf8').split('\n').filter(Boolean);
    const modules = lines
      .filter((line) => line !== 'node:crypto')
      .flatMap((file) =>
        [...readFileSync(file, 'utf8').matchAll(pluginModule)].flatMap(
          (found) => found.groups?.path ?? [],
        ),
      )
      .filter((path) => watched.some((folder) => path.startsWith(folder)));
    return {
      ...result,
      crypto: lines.includes('node:crypto'),
      modules: new Set(modules),
    };
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
}

test('--version loads each plugin Command declaration, no Command implementation, and no node:crypto', () => {
  const result = launched(['--version']);
  expect(result.status).toBe(0);
  expect(result.modules).toEqual(
    new Set([
      'completion/plugin.js',
      'completion/shell-names.js',
      'manpage/pages.js',
      'manpage/plugin.js',
      'mcp/agents.js',
      'mcp/exposure.js',
      'mcp/extension.js',
      'mcp/faults.js',
      'mcp/groups.js',
      'mcp/plugin.js',
      'mcp/tools.js',
    ]),
  );
  expect(result.crypto).toBe(false);
});

test('completion bash loads the Bash script when it runs and prints it', () => {
  const result = launched(['completion', 'bash']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('complete -o default -F');
  expect(result.modules.has('completion/bash.js')).toBe(true);
});

test('mcp config loads its implementation when it runs and prints a client configuration', () => {
  const result = launched(['mcp', 'config']);
  expect(result.status).toBe(0);
  expect(result.stdout).toContain('"jsonkit"');
  expect(result.modules.has('mcp/config.js')).toBe(true);
});
