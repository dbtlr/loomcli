import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Application, InputError, plugin } from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

/**
 * The position a dropped-value line and a strict failure name for an array item: its position in
 * the file as read, in every round, under "What a path removes" in the plugin's reference.
 */

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

/** What one run came to: its status, its stderr, and the failure's problems. */
interface Ran {
  readonly status: number | undefined;
  readonly stderr: string;
  readonly issues: readonly string[];
}

/** Runs an application that reads `.app.json` under the schema and strictness, linking `stateDir`. */
async function ran(
  schema: StandardSchemaV1,
  file: unknown,
  strict: readonly [string, ...string[]] | undefined,
): Promise<Ran> {
  const root = mkdtempSync(join(tmpdir(), 'loom-drop-positions-'));
  try {
    writeFileSync(join(root, '.app.json'), JSON.stringify(file));
    const mock = mockProcess({ argv: ['-L'], cwd: root, env: { HOME: root } });
    const config = configuration({
      file: '.app.json',
      schema,
      ...(strict === undefined ? {} : { strict }),
    });
    const build = () =>
      new Application('app', { plugins: [config.plugin, loud] })
        .option('state', { extensions: [configInput({ path: 'stateDir' })], type: 'string' })
        .action(() => {});
    await build().run({ process: mock });
    const outcome = await build().invoke(
      [],
      {},
      { process: mockProcess({ cwd: root, env: { HOME: root } }) },
    );
    const failure = outcome.status === 'failed' ? outcome.failure : undefined;
    const issues =
      failure instanceof InputError
        ? failure.problems.flatMap((problem) =>
            problem.reason === 'invalid' ? problem.issues.map((issue) => issue.message) : [],
          )
        : [];
    return { issues, status: mock.exitCode, stderr: mock.stderr.text };
  } finally {
    rmSync(root, { force: true, recursive: true });
  }
}

const wrong = 'Invalid input: expected string, received number';

/** The array's refinement judges its items only once each holds, so it drops in a second round. */
const sources = z.array(z.object({ harness: z.string() })).superRefine((items, context) => {
  items.forEach((item, index) => {
    if (item.harness === 'bad') {
      context.addIssue({ code: 'custom', message: 'A bad harness.', path: [index] });
    }
  });
});
const sourcesSchema = z.object({
  sessions: z.object({ sources: sources.optional() }).optional(),
  stateDir: z.string().optional(),
});

// Round one drops item 0; round two drops the items at 1 and 3 of what is left, which are 2 and 4 as read.
const twoRounds = {
  sessions: {
    sources: [
      { harness: 1 },
      { harness: 'a' },
      { harness: 'bad' },
      { harness: 'b' },
      { harness: 'bad' },
    ],
  },
};

test('a later round names an item by its position in the file as read', async () => {
  const result = await ran(sourcesSchema, twoRounds, undefined);
  expect(result.status).toBe(0);
  expect(result.stderr).toBe(
    `› Ignored sessions.sources[0] in .app.json: ${wrong}\n` +
      '› Ignored sessions.sources[2] in .app.json: A bad harness.\n' +
      '› Ignored sessions.sources[4] in .app.json: A bad harness.\n',
  );
});

test('a strict failure names the same positions, in its line and its problem issues', async () => {
  const result = await ran(sourcesSchema, twoRounds, ['sessions.sources']);
  const lines = [
    `Configuration value sessions.sources[0].harness in .app.json: ${wrong}. Correct the value, or remove it.`,
    'Configuration value sessions.sources[2] in .app.json: A bad harness. Correct the value, or remove it.',
    'Configuration value sessions.sources[4] in .app.json: A bad harness. Correct the value, or remove it.',
  ];
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(`app: ${lines.join('\napp: ')}\n`);
  expect(result.issues).toEqual(lines);
});

test('nested arrays name each level by its position in the file as read', async () => {
  const groups = z
    .array(z.object({ items: z.array(z.object({ name: z.string() })) }))
    .superRefine((list, context) => {
      list.forEach((group, index) => {
        group.items.forEach((item, at) => {
          if (item.name === 'bad') {
            context.addIssue({ code: 'custom', message: 'Bad.', path: [index, 'items', at] });
          }
        });
      });
    });
  const schema = z.object({ groups: groups.optional(), stateDir: z.string().optional() });
  const file = {
    groups: [{}, { items: [{ name: 'a' }, { name: 'bad' }] }, { items: [{ name: 'bad' }] }],
  };
  const dropped = await ran(schema, file, undefined);
  expect(dropped.stderr).toBe(
    '› Ignored groups[0] in .app.json: Invalid input: expected array, received undefined\n' +
      '› Ignored groups[1] in .app.json: Bad.\n' +
      '› Ignored groups[2] in .app.json: Bad.\n',
  );
  const failed = await ran(schema, file, ['groups']);
  expect(failed.issues).toEqual([
    'Configuration value groups[0].items in .app.json: Invalid input: expected array, received undefined. Correct the value, or remove it.',
    'Configuration value groups[1].items[1] in .app.json: Bad. Correct the value, or remove it.',
    'Configuration value groups[2].items[0] in .app.json: Bad. Correct the value, or remove it.',
  ]);
});

test('a file that drops in one round, or drops nothing from an array, prints as before', async () => {
  const oneRound = {
    sessions: { sources: [{ harness: 1 }, { harness: 'a' }, { harness: 2 }, { harness: 'b' }] },
  };
  const first = await ran(sourcesSchema, oneRound, undefined);
  expect(first.stderr).toBe(
    `› Ignored sessions.sources[0] in .app.json: ${wrong}\n› Ignored sessions.sources[2] in .app.json: ${wrong}\n`,
  );
  const second = await ran(sourcesSchema, { sessions: { sources: [{ harness: 'a' }] } }, undefined);
  expect(second.stderr).toBe('');
  const third = await ran(sourcesSchema, oneRound, ['sessions.sources']);
  expect(third.issues).toEqual([
    `Configuration value sessions.sources[0].harness in .app.json: ${wrong}. Correct the value, or remove it.`,
    `Configuration value sessions.sources[2].harness in .app.json: ${wrong}. Correct the value, or remove it.`,
  ]);
});
