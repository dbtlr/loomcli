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

/** The plugin entry points and chunks Bun names in the application bundle. */
const pluginArtifact = /^\/\/ (?:\.\.\/)*packages\/plugins\/(?<path>dist\/\S+\.js)$/gmu;
const { outputs }: { outputs: Record<string, string[]> } = JSON.parse(
  readFileSync(new URL('../../../packages/plugins/dist/provenance.json', import.meta.url), 'utf8'),
);

/** The folders whose modules hold the completion, manpage, and MCP plugins and the files they install. */
const watched = ['completion/', 'manpage/', 'mcp/', 'installation/'];

/**
 * One run of the bundle: its exit status and output, the set of watched plugin modules it loaded,
 * and whether it loaded `node:crypto`. Provenance lists each library artifact's inputs, including
 * a re-export the application bundle can tree shake.
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
        [...readFileSync(file, 'utf8').matchAll(pluginArtifact)].flatMap(
          (found) => outputs[found.groups?.path ?? ''] ?? [],
        ),
      )
      .filter((path) => path.startsWith('dist/src/'))
      .map((path) => path.slice('dist/src/'.length))
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
      'completion/extension.js',
      // Every launch's synchronous graph build runs the judge of completer names, so it loads.
      // The judge holds its fault's sentence, so the plugin's message module stays unloaded.
      'completion/judge.js',
      'completion/plugin.js',
      'completion/refresh.js',
      'completion/shell-names.js',
      // Bun shares these helpers with the change-event templates in the common message module.
      'installation/disk.js',
      'installation/record.js',
      'manpage/pages.js',
      'manpage/plugin.js',
      'manpage/refresh.js',
      // The mcp Command's --http option validates its value at declaration, with its issue sentence.
      'mcp/address.js',
      'mcp/agents.js',
      'mcp/exposure.js',
      'mcp/extension.js',
      'mcp/faults.js',
      'mcp/groups.js',
      'mcp/messages.js',
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
