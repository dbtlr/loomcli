import { Application, Command } from '@loomcli/core';
import { format, jsonl } from '@loomcli/plugins/format';
import { expect, test } from 'vite-plus/test';
import { z } from 'zod';

import { inspectList, run, runGated } from './fixtures/format-rows.js';
import { runOnMock } from './fixtures/in-process.js';

/*
 * JsonlRows() (docs/plugins/format.md, Views): the row form of jsonl the formatter's hook declares
 * under a rows result, which writes each line as its row arrives.
 */

const done = (stdout: string) => ({ status: 0, stderr: '', stdout });

/** A valid JSON row followed by a value that JSON cannot encode. */
function* undefinedRowSource() {
  // eslint-disable-next-line id-length -- The one-letter key pins the requested JSON wire form.
  yield { a: 1 };
  yield undefined;
}

test('the first line is written before the source finishes', async () => {
  await expect(runGated()).resolves.toEqual([
    'write:{"count":1}',
    'source:finished',
    'write:{"count":2}',
  ]);
});

test.each(['rows', 'tojson', 'controls', 'empty'])(
  'the row form writes the bytes the whole jsonl() writes for %s',
  async (scenario) => {
    const streamed = await run(scenario);
    const whole = await run(scenario, 'whole');
    expect(streamed).toEqual(whole);
    expect(streamed.status).toBe(0);
  },
);

test('the row form writes one line per row, honors toJSON, escapes controls, and prints nothing for no rows', async () => {
  await expect(run('rows')).resolves.toEqual(done('{"count":1}\n{"count":2}\n'));
  await expect(run('tojson')).resolves.toEqual(done('{"wrapped":1}\n{"wrapped":2}\n'));
  await expect(run('controls')).resolves.toEqual(done('"a\\u001bb\\u009bc\\u007fd"\n'));
  await expect(run('empty')).resolves.toEqual(done(''));
});

test('map applies to each row', async () => {
  await expect(run('map')).resolves.toEqual(done('1\n2\n'));
});

test('a source that throws keeps the lines written and writes no tail, and the jsonl failure line is its only stderr text', async () => {
  const result = await run('throws');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('{"count":1}\n{"count":2}\n');
  // Core holds the incomplete line back when a failure encoder writes the run's failure, as the
  // Jsonl encoder does, so the encoded line is the only stderr text.
  expect(result.stderr).toBe(
    '{"error":{"code":"internal","exitCode":1,"message":"Something went wrong.","hints":[]}}\n',
  );
});

test('an undefined row keeps the written line and reports the whole view encode failure', async () => {
  const outcomes = [];
  for (const whole of [false, true]) {
    const list = new Command('list')
      .rows<unknown>({
        views: {
          table: { row: () => '' },
          ...(whole ? { jsonl: jsonl() } : {}),
        },
      })
      .action(({ out }) => out.results(undefinedRowSource()));
    const app = new Application('rows', { plugins: [format()] }).command(list);
    outcomes.push(
      await runOnMock(app, {
        argv: ['list', '--format', 'jsonl'],
        release: { build: 'distributed' },
      }),
    );
  }
  const failure = {
    status: 1,
    stderr:
      '{"error":{"code":"internal","exitCode":1,"message":"Something went wrong.","hints":[]}}\n',
  };
  expect(outcomes).toEqual([
    { ...failure, stdout: '{"a":1}\n' },
    { ...failure, stdout: '' },
  ]);
});

test('a bigint row is the existing encode failure', async () => {
  const result = await run('bigint');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
});

test('inspect publishes application/jsonl for the rows Command, as a row view is one under the hook', () => {
  const schema = z.looseObject({
    root: z.looseObject({
      children: z.array(
        z.looseObject({ name: z.string(), result: z.looseObject({ mediaTypes: z.unknown() }) }),
      ),
    }),
  });
  for (const mode of ['hook', 'whole'] as const) {
    const graph = schema.parse(inspectList(mode));
    expect(
      graph.root.children.find((child) => child.name === 'list')?.result.mediaTypes,
    ).toMatchObject({
      jsonl: 'application/jsonl',
    });
  }
});
