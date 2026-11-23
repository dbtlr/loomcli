import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

const app = new Application('clone', { plugins: [help(), manifest()] })
  .argument('url', { required: 'non-interactive' })
  .argument('files', { required: 'non-interactive', variadic: true })
  .option('tag', { multiple: true, required: 'non-interactive', type: 'string' })
  .action(() => {});

test('help shows conditional arguments as required operands with a conditional row fact', async () => {
  const mock = mockProcess({ argv: ['--help'] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(mock.stdout.text).toContain('clone <url> <files...> [options]');
  expect(mock.stdout.text).toContain('url    (required when not interactive)');
  expect(mock.stdout.text).toContain('files  (required when not interactive)');
  expect(mock.stdout.text).toContain('(required when not interactive, repeatable)');
});

test('manifest publishes conditional requiredness on every argument', async () => {
  const mock = mockProcess({ argv: ['--manifest'] });
  await expect(app.run({ process: mock })).resolves.toBe(0);
  expect(JSON.parse(mock.stdout.text)).toMatchObject({
    command: {
      arguments: [
        { name: 'url', required: false, requiredWhen: 'non-interactive' },
        { name: 'files', required: false, requiredWhen: 'non-interactive' },
      ],
    },
  });
});

test('a configured empty list reads as no values at a terminal and is missing off one', async () => {
  // The root marker ends the project walk in the sandbox, and the user scope is not read.
  const project = mkdtempSync(join(tmpdir(), 'loom-conditional-'));
  try {
    writeFileSync(join(project, 'package.json'), '{}');
    writeFileSync(join(project, '.tagger.json'), JSON.stringify({ tag: [] }));
    const { plugin: installed } = configuration({
      root: 'package.json',
      schema: z.object({ tag: z.array(z.string()).optional() }),
      scopes: ['project'],
    });
    const seen: unknown[] = [];
    const tagger = new Application('tagger', { plugins: [installed] })
      .option('tag', {
        extensions: [configInput({ path: 'tag' })],
        multiple: true,
        required: 'non-interactive',
        type: 'string',
      })
      .action(({ options }) => {
        seen.push(options.tag);
      });
    const terminal = mockProcess({
      cwd: project,
      terminal: { columns: 80, keys: [], rows: 24 },
    });
    await expect(tagger.run({ process: terminal })).resolves.toBe(0);
    expect(seen).toEqual([[]]);
    const batch = mockProcess({ cwd: project });
    await expect(tagger.run({ process: batch })).resolves.toBe(2);
    expect(batch.stderr.text).toBe(
      'tagger: Option "--tag" (from tag in .tagger.json) is required when input is not interactive. Supply at least one value.\n',
    );
    expect(seen).toEqual([[]]);
  } finally {
    rmSync(project, { force: true, recursive: true });
  }
});

test('a conditional variadic argument given an empty list by name is missing off a terminal', async () => {
  const outcome = await app.invoke(
    [],
    { args: { files: [], url: 'x' }, options: { tag: ['a'] } },
    { process: mockProcess() },
  );
  expect(outcome).toMatchObject({
    exitCode: 2,
    messages:
      'clone: Argument "files" requires at least one value when input is not interactive. Supply a value for "files".\n',
    status: 'failed',
  });
});
