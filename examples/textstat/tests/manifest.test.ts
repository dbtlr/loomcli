import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { invoke } from '../../../scripts/test-process.js';

const main = new URL('../dist/src/main.js', import.meta.url);

test('textstat --manifest prints the whole application, omitting the hidden --timing', () => {
  expect(invoke(main, ['--manifest'])).toEqual({
    status: 0,
    stderr: '',
    stdout: readFileSync(new URL('fixtures/manifest/root.json', import.meta.url), 'utf8'),
  });
});

/** The part of the document an agent reads to build one invocation, parsed at the boundary. */
const option = z.object({
  long: z.string().nullable(),
  name: z.string(),
  schema: z.object({ enum: z.array(z.string()).optional() }).nullable(),
});
const readable = z.object({
  command: z.object({
    arguments: z.array(z.object({ name: z.string(), variadic: z.boolean() })),
    options: z.array(option),
    result: z.object({ kind: z.string(), views: z.array(z.string()) }).nullable(),
  }),
  encodings: z.object({ json: z.string() }),
});

test('an agent builds a valid invocation from the manifest alone and parses the promised encoding', () => {
  const document = readable.parse(JSON.parse(invoke(main, ['--manifest']).stdout));
  const { command } = document;
  // The agent picks a metric from the schema's enum and the json view from the result's views.
  const metric = command.options.find((entry) => entry.name === 'metric');
  const format = command.options.find((entry) => entry.name === 'format');
  const words = metric?.schema?.enum?.find((value) => value === 'words');
  expect(command.result).toMatchObject({ kind: 'rows' });
  expect(command.result?.views).toContain('json');
  expect(format?.schema?.enum).toContain('json');
  expect(command.arguments[0]).toEqual({ name: 'files', variadic: true });
  const directory = mkdtempSync(join(tmpdir(), 'loom-textstat-agent-'));
  try {
    writeFileSync(join(directory, 'one.txt'), 'two words\n');
    writeFileSync(join(directory, 'two.txt'), 'three more words\n');
    const argv = [
      metric?.long ?? '',
      words ?? '',
      format?.long ?? '',
      'json',
      'one.txt',
      'two.txt',
    ];
    const result = invoke(main, argv, { cwd: directory });
    expect(result).toMatchObject({ status: 0, stderr: '' });
    // A rows result under json is one JSON array of its rows, as `encodings.json` states.
    expect(JSON.parse(result.stdout)).toEqual([
      { count: 2, source: 'one.txt' },
      { count: 3, source: 'two.txt' },
    ]);
  } finally {
    rmSync(directory, { force: true, recursive: true });
  }
});
