import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, plugin } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { mockProcess } from '@loomcli/testing';
import { object, optional, string } from 'valibot';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/**
 * The lines the configuration plugin writes at -v for a key the file holds that the published JSON
 * Schema does not describe, under "Naming unknown keys" in the plugin's reference.
 */

const unknownLine = (path: string, name = '.app.json') =>
  `› Ignored ${path} in ${name}: Unknown key. Check its spelling, or remove it.\n`;

/** A verbose mark, spelled -L, so a run can show its `-v` lines. */
const loud = plugin('fixture/loud', {
  options: {
    loud: {
      control: true,
      description: 'Show more detail.',
      short: 'L',
      type: 'count',
      verbose: true,
    },
  },
});

/** Runs an application that reads `.app.json` under the schema and answers what it wrote to stderr. */
async function stderrOf(
  schema: StandardSchemaV1,
  file: unknown,
  argv: readonly string[] = ['-L'],
  linked = 'stateDir',
): Promise<string> {
  return stderrOfText(schema, '.app.json', JSON.stringify(file), argv, linked);
}

/** Runs the same application over a file written as `text` under `name`, and answers its stderr. */
async function stderrOfText(
  schema: StandardSchemaV1,
  name: string,
  text: string,
  argv: readonly string[] = ['-L'],
  linked = 'stateDir',
): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'loom-unknown-keys-'));
  try {
    writeFileSync(join(root, name), text);
    const mock = mockProcess({ argv, cwd: root, env: { HOME: root } });
    const config = configuration({ file: name, schema });
    // The plugin reads the file only for a run that links an option or opts in to the provider.
    await new Application('app', { plugins: [config.plugin, loud] })
      .option('state', {
        description: 'The state directory.',
        extensions: [configInput({ path: linked })],
        type: 'string',
      })
      .action(() => {})
      .run({ process: mock });
    return mock.stderr.text;
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const closed = z.object({
  sessions: z
    .object({
      sources: z.array(z.object({ harness: z.string(), name: z.string().optional() })).optional(),
    })
    .optional(),
  stateDir: z.string().optional(),
  updates: z.object({ channel: z.string().optional(), interval: z.number().optional() }).optional(),
});

test('a top-level and a nested unknown key each name one line at -v, in file order', async () => {
  const file = { stateDir: 'y', state_dir: 'x', updates: { chanel: 'beta', interval: 5 } };
  await expect(stderrOf(closed, file)).resolves.toBe(
    unknownLine('state_dir') + unknownLine('updates.chanel'),
  );
});

test('an unknown key names nothing at the default verbosity', async () => {
  await expect(stderrOf(closed, { state_dir: 'x' }, [])).resolves.toBe('');
});

test('a misspelled key in an array item names its index in the file', async () => {
  const file = { sessions: { sources: [{ harness: 'a' }, { harness: 'b', nmae: 'x' }] } };
  await expect(stderrOf(closed, file)).resolves.toBe(unknownLine('sessions.sources[1].nmae'));
});

test('a section kept as z.unknown(), a record, and a loose object name nothing', async () => {
  const open = z.object({
    free: z.unknown().optional(),
    loose: z.looseObject({ known: z.string().optional() }).optional(),
    name: z.string().optional(),
    table: z.record(z.string(), z.object({ id: z.string().optional() })).optional(),
  });
  const file = {
    free: { any: { thing: 1 } },
    loose: { extra: 1 },
    table: { first: { id: 'x' }, second: {} },
  };
  await expect(stderrOf(open, file, ['-L'], 'name')).resolves.toBe('');
});

test('a valibot schema publishes no JSON Schema, so no unknown key is named', async () => {
  const schema = object({ stateDir: optional(string()) });
  await expect(stderrOf(schema, { state_dir: 'x' })).resolves.toBe('');
});

test('the $schema pointer is never an unknown key', async () => {
  await expect(stderrOf(closed, { $schema: 'https://example.test/s.json' })).resolves.toBe('');
});

test('a key below the top level named $schema is an ordinary key', async () => {
  await expect(stderrOf(closed, { updates: { $schema: 'x' } })).resolves.toBe(
    unknownLine('updates.$schema'),
  );
});

test('a key at or below a dropped value names no line of its own, and an unknown key beside one does', async () => {
  const file = {
    sessions: {
      sources: [
        { harness: 1, nmae: 'x' },
        { harness: 'b', nmae: 'y' },
      ],
    },
    updates: { interval: 'soon', nope: 1 },
  };
  const text = await stderrOf(closed, file);
  const lines = text.split('\n').filter((line) => line !== '');
  const unknown = lines.filter((line) => line.includes('Unknown key'));
  expect(unknown).toEqual([
    unknownLine('sessions.sources[1].nmae').trimEnd(),
    unknownLine('updates.nope').trimEnd(),
  ]);
  expect(lines.slice(0, 2).join('\n')).toMatch(/sessions\.sources\[0\][^]*updates\.interval/u);
  expect(lines).toHaveLength(4);
});

test('a key that holds a dot names its text as a nested path', async () => {
  await expect(stderrOf(closed, { 'updates.channel': 'beta' })).resolves.toBe(
    unknownLine('updates.channel'),
  );
});

test('a control character in a key prints as its escape on one line', async () => {
  await expect(stderrOf(closed, { 'a\nb': 1 })).resolves.toBe(unknownLine(String.raw`a\u000ab`));
});

test('an array item keeps its position in the file as read across a second round of drops', async () => {
  // The refinement judges the array only once its items hold, so it drops an item in a second round.
  const sources = z
    .array(z.object({ harness: z.string(), name: z.string().optional() }))
    .superRefine((items, context) => {
      if (items[0]?.harness === 'bad') {
        context.addIssue({ code: 'custom', message: 'A bad harness.', path: [0] });
      }
    });
  const schema = z.object({
    sessions: z.object({ sources: sources.optional() }).optional(),
    stateDir: z.string().optional(),
  });
  const file = {
    sessions: {
      sources: [{ harness: 1 }, { harness: 'bad' }, { harness: 'c' }, { harness: 'd', nmae: 'x' }],
    },
  };
  const text = await stderrOf(schema, file);
  const lines = text.split('\n');
  expect(lines.filter((line) => line.includes('Unknown key'))).toEqual([
    unknownLine('sessions.sources[3].nmae').trimEnd(),
  ]);
  // Two dropped items, one in each round, and the unknown key.
  expect(lines.filter((line) => line.includes('Ignored sessions.sources['))).toHaveLength(3);
});

test('a YAML value two aliases share is walked at each path', async () => {
  const text = 'sessions:\n  sources:\n    - &one { harness: a, nmae: x }\n    - *one\n';
  await expect(stderrOfText(closed, '.app.yaml', text)).resolves.toBe(
    unknownLine('sessions.sources[0].nmae', '.app.yaml') +
      unknownLine('sessions.sources[1].nmae', '.app.yaml'),
  );
});

test('a YAML value inside itself is walked once, and its unknown key is named once', async () => {
  const node: z.ZodType = z.lazy(() =>
    z.object({ child: node.optional(), name: z.string().optional() }),
  );
  const text = '&a\nchild: *a\nnmae: x\n';
  await expect(stderrOfText(node, '.app.yaml', text, ['-L'], 'name')).resolves.toBe(
    unknownLine('nmae', '.app.yaml'),
  );
});

test('a tuple item is walked against its own entry, so a misspelled key inside it is named', async () => {
  const schema = z.object({
    pair: z.tuple([z.object({ id: z.string() }), z.object({ label: z.string() })]).optional(),
    stateDir: z.string().optional(),
  });
  const file = { pair: [{ id: 'a' }, { label: 'b', lable: 'c' }] };
  await expect(stderrOf(schema, file)).resolves.toBe(unknownLine('pair[1].lable'));
});
