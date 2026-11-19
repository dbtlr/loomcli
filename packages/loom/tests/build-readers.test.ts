/*
 * Acceptance plan for the configuration readers in a bundle (docs/plugins/config.md#readers).
 *
 * `loom build --target node` bundles a fixture application that installs the configuration plugin,
 * and the test scans every file the build wrote for the module paths Bun writes above each bundled
 * module:
 *
 * - An application that passes no reader bundles neither `smol-toml` nor `yaml`.
 * - One that passes `toml` bundles `smol-toml` and not `yaml`, and its bundle reads a TOML file
 *   `--config` names.
 * - The `loom` bin passes no reader, so its own bundle holds no `smol-toml`.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, expect, test, vi } from 'vite-plus/test';

import { put, removeRoots } from './fixture.js';
import { execute, fixturePackage, loom } from './package.js';

// Ceil the toolchain's walks up from a fixture at the sandbox (see ./ceiling.ts).
vi.mock(import('node:fs'), async (importOriginal) => {
  const { ceiled } = await import('./ceiling.js');
  return ceiled(await importOriginal());
});

afterEach(() => {
  removeRoots();
});

/** How long a build of the fixture may take. */
const slow = 120_000;

/** The parsers a bundle may hold, by the folder Bun names in the comment above each module. */
const parserPaths = {
  'smol-toml': /node_modules\/smol-toml\//u,
  yaml: /node_modules\/yaml\//u,
};

/** The parsers whose modules the files under a directory hold. */
function bundledParsers(directory: string): string[] {
  const text = readdirSync(directory, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.js'))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), 'utf8'))
    .join('\n');
  return Object.entries(parserPaths)
    .filter(([, path]) => path.test(text))
    .map(([name]) => name);
}

/**
 * A package whose application installs the configuration plugin with the file and the readers
 * given, prints the title its file sets, and runs from `src/main.ts`.
 */
function readerPackage({ file, readers }: { file: string; readers: readonly ('toml' | 'yaml')[] }) {
  const imports = readers
    .map((reader) => `import { ${reader} } from '@loomcli/plugins/config/${reader}';\n`)
    .join('');
  const application = `import { Application } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
${imports}
// A schema that accepts every file, so the fixture needs no validation library.
const schema = { '~standard': { validate: (value: unknown) => ({ value }), vendor: 'probe', version: 1 as const } };

const { plugin } = configuration({ file: '${file}', formats: [${readers.join(', ')}], schema });

export const probe = new Application('probe', { plugins: [plugin] })
  .option('title', { default: 'none', description: 'The title.', extensions: [configInput({ path: 'title' })], type: 'string' })
  .action(({ options, out }) => out.print(options.title));
`;
  return fixturePackage(
    {
      'package.json': `${JSON.stringify({ name: '@acme/probe', type: 'module', version: '1.0.0' })}\n`,
      'src/application.ts': application,
      'src/main.ts': `import { probe } from './application.js';\n\nawait probe.run();\n`,
    },
    ['core', 'plugins'],
  );
}

/** Builds a package for Node and answers the parsers its output holds. */
async function built(root: string): Promise<string[]> {
  const result = await loom(root, ['build', '--target', 'node']);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return bundledParsers(join(root, 'dist'));
}

test(
  'an application that passes no reader bundles neither parser',
  async () => {
    const root = readerPackage({ file: '.probe.json', readers: [] });
    await expect(built(root)).resolves.toEqual([]);
  },
  slow,
);

test(
  'an application that passes the TOML reader bundles smol-toml alone, and reads a TOML file',
  async () => {
    const root = readerPackage({ file: '.probe.{toml,json}', readers: ['toml'] });
    await expect(built(root)).resolves.toEqual(['smol-toml']);
    put(root, 'x.toml', 'title = "from toml"\n');
    const runtime = process.env.LOOM_TEST_RUNTIME ?? 'node';
    const result = execute(join(root, 'dist/main.js'), ['--config', join(root, 'x.toml')], {
      runtime,
    });
    expect(result).toEqual({ status: 0, stderr: '', stdout: 'from toml\n' });
  },
  slow,
);

test("the loom bin's own bundle holds no TOML parser", () => {
  const dist = fileURLToPath(new URL('../dist', import.meta.url));
  expect(bundledParsers(dist)).not.toContain('smol-toml');
});
