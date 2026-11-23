/*
 * Acceptance plan for the configuration readers (docs/plugins/config.md#readers).
 *
 * JSON is built in, and TOML and YAML read only through the reader an application passes in
 * `formats`, so an application that passes neither imports neither parser.
 *
 * - The default. With no `formats`, a `file` that names toml, yaml, or yml, in a brace list or as
 *   a literal name, throws at `configuration()` under `@loomcli/plugins/config/file-format`, naming
 *   the reader to pass; a literal name of any other extension still reads as JSON.
 * - `*`. An extension of `*` tries each passed reader's extensions, in the plugin's order whatever
 *   the order of `formats`, then json and jsonc, so with no readers it never finds a TOML file.
 * - Reading. A passed reader reads its files, and a brace list that names a format whose reader is
 *   not passed still throws.
 * - `--config`. A named `.toml`, `.yaml`, or `.yml` file the application does not read fails with
 *   code 2 before any read, naming its format and the formats the application reads; any other
 *   extension reads as JSON.
 * - The variable. A file the `env` variable names in a format the application does not read warns
 *   once and the run reads no configuration.
 */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, DeclarationError } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import type { ConfigurationReader } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { toml } from '@loomcli/plugins/config/toml';
import { yaml } from '@loomcli/plugins/config/yaml';
import { mockProcess } from '@loomcli/testing';
import { afterEach, expect, test } from 'vite-plus/test';
import { z } from 'zod';

const schema = z.object({ title: z.string().optional() });

/** The settings a case gives besides the schema. */
interface Settings {
  readonly file?: string;
  readonly formats?: readonly ConfigurationReader[];
  readonly env?: string;
}

/** The fault `configuration()` throws for the settings, as its rule, sentence, and correction, or "returned". */
function fault(settings: Settings) {
  try {
    configuration({ ...settings, schema });
    return 'returned';
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    const { correction, findings, rule, sentence } = error;
    return {
      correction,
      marks: findings.map(({ mark }) => mark),
      rule: rule?.identity,
      sentence,
    };
  }
}

/** The directories each test made, removed after it. */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { force: true, recursive: true });
  }
});

/** A project directory holding the files given, inside a sandbox that ends every walk. */
function project(files: Readonly<Record<string, string>>): { root: string; cwd: string } {
  const root = mkdtempSync(join(tmpdir(), 'loom-readers-'));
  roots.push(root);
  const cwd = join(root, 'project');
  mkdirSync(cwd);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(cwd, name), content);
  }
  return { cwd, root };
}

/** One argv run of an application that prints the title its configuration reads. */
async function run(
  settings: Settings,
  files: Readonly<Record<string, string>>,
  { argv = [], env = {} }: { argv?: string[]; env?: Record<string, string> } = {},
) {
  const { cwd, root } = project(files);
  const { plugin } = configuration({ ...settings, schema });
  const app = new Application('app', { plugins: [plugin] })
    .option('title', {
      default: 'none',
      description: 'The title.',
      extensions: [configInput({ path: 'title' })],
      type: 'string',
    })
    .action(({ options, out }) => out.print(options.title));
  const mock = mockProcess({ argv, ceiling: root, cwd, env: { HOME: join(root, 'home'), ...env } });
  await app.run({ process: mock });
  return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

const formatRule = '@loomcli/plugins/config/file-format';

test.each([
  ['.app.{toml,json}', 'toml', 'toml'],
  ['.app.{json,yaml}', 'yaml', 'yaml'],
  ['.app.{yml,json}', 'yml', 'yaml'],
  ['.app.toml', 'toml', 'toml'],
  ['config/app.yml', 'yml', 'yaml'],
])('with no formats, file %s throws naming the %s reader to pass', (file, extension, reader) => {
  expect(fault({ file })).toEqual({
    correction: `Pass ${reader}, from @loomcli/plugins/config/${reader}, in formats.`,
    marks: ['0.file'],
    rule: formatRule,
    sentence: `Plugin "@loomcli/plugins/config" file names ${extension} files, and formats holds no reader for them.`,
  });
});

test('with no formats, json, jsonc, *, and a literal name of another extension are accepted', () => {
  for (const file of ['.app.json', '.app.{json,jsonc}', '.app.*', '.apprc', '.app.conf']) {
    expect(fault({ file })).toBe('returned');
  }
});

test('a passed reader covers its own extensions and no other format', () => {
  expect(fault({ file: '.app.{toml,json}', formats: [toml] })).toBe('returned');
  expect(fault({ file: '.app.{yaml,yml}', formats: [yaml] })).toBe('returned');
  expect(fault({ file: '.app.{toml,yaml}', formats: [toml] })).toMatchObject({
    correction: 'Pass yaml, from @loomcli/plugins/config/yaml, in formats.',
    rule: formatRule,
  });
});

test('an unknown extension in a brace list is a pattern fault, whatever formats holds', () => {
  expect(fault({ file: '.app.{toml,ini}' })).toMatchObject({
    rule: '@loomcli/plugins/config/file-pattern',
    sentence: 'Plugin "@loomcli/plugins/config" file lists an extension the plugin cannot read.',
  });
});

test('with no formats, * tries json and jsonc alone, so a TOML file beside them is never found', async () => {
  const alone = await run({ file: '.app.*' }, { '.app.toml': 'title = "toml"\n' });
  expect(alone).toEqual({ status: 0, stderr: '', stdout: 'none\n' });
  const both = await run(
    { file: '.app.*' },
    { '.app.json': '{ "title": "json" }', '.app.toml': 'title = "toml"\n' },
  );
  expect(both).toEqual({ status: 0, stderr: '', stdout: 'json\n' });
});

test('* tries the passed readers in the plugin order, TOML, YAML, then JSON, whatever the order of formats', async () => {
  const files = {
    '.app.json': '{ "title": "json" }',
    '.app.toml': 'title = "toml"\n',
    '.app.yml': 'title: yml\n',
  };
  const result = await run({ file: '.app.*', formats: [yaml, toml] }, files);
  expect(result.stdout).toBe('toml\n');
  expect(result.stderr).toBe(
    '⚠ Skipped .app.yml, .app.json: .app.toml matches the same pattern first. Keep one of the files, and remove the others.\n',
  );
  const yamlOnly = await run({ file: '.app.*', formats: [yaml] }, files);
  expect(yamlOnly.stdout).toBe('yml\n');
});

test('a passed reader reads its file', async () => {
  await expect(
    run({ file: '.app.toml', formats: [toml] }, { '.app.toml': 'title = "toml"\n' }),
  ).resolves.toEqual({ status: 0, stderr: '', stdout: 'toml\n' });
  await expect(
    run({ file: '.app.yml', formats: [yaml] }, { '.app.yml': 'title: yml\n' }),
  ).resolves.toEqual({ status: 0, stderr: '', stdout: 'yml\n' });
});

test.each([
  ['x.toml', [], 'TOML', 'JSON'],
  ['x.yaml', [], 'YAML', 'JSON'],
  ['x.yml', [toml], 'YAML', 'JSON or TOML'],
  ['x.toml', [yaml], 'TOML', 'JSON or YAML'],
])(
  '--config %s fails before any read when the application does not read its format',
  async (file, formats, format, choices) => {
    // The file does not exist: the format is known from the name, so nothing is read.
    const result = await run({ formats }, {}, { argv: ['--config', file] });
    expect(result).toEqual({
      status: 2,
      stderr: `app: Option "--config": File "${file}" is ${format}, which this application does not read. Supply a ${choices} file.\n`,
      stdout: '',
    });
  },
);

test('--config reads a file of any other extension as JSON', async () => {
  const result = await run(
    {},
    { 'x.conf': '{ "title": "conf" }' },
    { argv: ['--config', 'x.conf'] },
  );
  expect(result).toEqual({ status: 0, stderr: '', stdout: 'conf\n' });
});

test('a file the variable names in a format the application does not read warns and reads no configuration', async () => {
  const result = await run(
    { env: 'APP_CONFIG' },
    { 'x.toml': 'title = "toml"\n' },
    { env: { APP_CONFIG: 'x.toml' } },
  );
  expect(result).toEqual({
    status: 0,
    stderr:
      '⚠ Skipped x.toml: the file is TOML, which this application does not read, so this run reads no configuration. Supply a JSON file.\n',
    stdout: 'none\n',
  });
});
