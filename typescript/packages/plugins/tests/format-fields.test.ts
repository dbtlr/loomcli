import { Application, Command, InputError } from '@loomcli/core';
import { format, json, jsonl } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { inspect as buildInspect } from './fixtures/format-build.js';
import { application, inspect, run } from './fixtures/format-fields.js';
import { runOnMock } from './fixtures/in-process.ts';

/*
 * Acceptance plan for `--fields` (docs/plugins/format.md, Selecting fields).
 *
 * - Under the formatter-appended json and jsonl, `--fields` keeps the named top-level keys, in
 *   the order named, for a value, an array, and a row stream; a row that lacks a key leaves it out. The option repeats,
 *   and each value is a comma list.
 * - A field the output does not hold fails with exit 2 and lists the keys it holds: from the value,
 *   or from the first row of a stream. A value or row that is not an object fails and names what it
 *   is, and the lines already streamed stay.
 * - Under a view the formatter did not append, `--fields` fails and names the formatter
 *   as the provider of the json and jsonl output it accepts. An empty field name fails at validation.
 * - `--fields` is a control option on the help page and in the graph, hidden on a group, and a
 *   Command's own `fields` option is the hook-collision fault.
 * - A Command whose json and jsonl views the author declares both gets no `--fields`, so its help
 *   and graph list none and a `fields` option of its own is its author's; one with a single
 *   author-declared view keeps it.
 */

const done = (stdout: string) => ({ status: 0, stderr: '', stdout });

/**
 * The JSON line the formatter's failure encoder writes for an `--fields` usage failure of
 * `command`. The keys keep the failure form's order, so the line is written as text, where the
 * key-sorting fixer cannot reorder it.
 */
function failureLine(command: string, message: string) {
  const hint = JSON.stringify(`Run "app ${command} --help" to see the usage.`);
  return `{"error":{"code":"invalid-input","exitCode":2,"message":${JSON.stringify(message)},"hints":[${hint}]}}\n`;
}

test('json keeps the named fields of a value in the order named', async () => {
  await expect(run(['get', '--format', 'json', '--fields', 'size,name'])).resolves.toEqual(
    done('{\n  "size": 1,\n  "name": "a"\n}\n'),
  );
});

test('jsonl keeps the named fields of each element of an array, and an element lacking one leaves it out', async () => {
  await expect(run(['ls', '--format', 'jsonl', '--fields', 'owner,name'])).resolves.toEqual(
    done('{"owner":"x","name":"a"}\n{"name":"b"}\n'),
  );
  await expect(run(['ls', '--format', 'json', '--fields', 'name'])).resolves.toEqual(
    done('[\n  {\n    "name": "a"\n  },\n  {\n    "name": "b"\n  }\n]\n'),
  );
});

test('jsonl keeps the named fields of each row of a stream, and a row lacking one leaves it out', async () => {
  await expect(run(['list', '--format', 'jsonl', '--fields', 'owner,name'])).resolves.toEqual(
    done('{"owner":"x","name":"a"}\n{"name":"b"}\n'),
  );
  await expect(run(['list', '--format', 'json', '--fields', 'size'])).resolves.toEqual(
    done('[\n  {\n    "size": 1\n  },\n  {\n    "size": 2\n  }\n]\n'),
  );
});

test('--fields repeats, and a field named twice is kept once', async () => {
  await expect(
    run(['get', '--format', 'jsonl', '--fields', 'name', '--fields', 'size,name']),
  ).resolves.toEqual(done('{"name":"a","size":1}\n'));
});

test('a field the value does not hold fails with exit 2 and lists the fields it holds', async () => {
  await expect(run(['get', '--format', 'json', '--fields', 'name,color'])).resolves.toEqual({
    status: 2,
    stderr: failureLine(
      'get',
      'Option "--fields" names "color", which the output does not hold. Supply fields from name, owner, size.',
    ),
    stdout: '',
  });
});

test('a field no element of an array holds fails, and one some element holds does not', async () => {
  const { status, stderr } = await run(['ls', '--format', 'jsonl', '--fields', 'color']);
  expect(status).toBe(2);
  expect(stderr).toContain('Supply fields from name, owner, size.');
});

test('under a stream the first row decides the known fields', async () => {
  // The list holds the first row's keys, owner among them, though the second row lacks it.
  await expect(run(['list', '--format', 'jsonl', '--fields', 'color'])).resolves.toEqual({
    status: 2,
    stderr: failureLine(
      'list',
      'Option "--fields" names "color", which the output does not hold. Supply fields from name, owner, size.',
    ),
    stdout: '',
  });
});

test('an output that holds no fields says so', async () => {
  const { status, stderr } = await run(['empty', '--format', 'json', '--fields', 'name']);
  expect(status).toBe(2);
  expect(stderr).toContain(
    String.raw`Option \"--fields\" names \"name\", but the output holds no fields. Remove the option.`,
  );
});

test('a value that is not an object fails and names what it is', async () => {
  await expect(run(['scalar', '--format', 'json', '--fields', 'name'])).resolves.toEqual({
    status: 2,
    stderr: failureLine(
      'scalar',
      'Option "--fields" selects fields of objects, but the output holds a string. Remove the option.',
    ),
    stdout: '',
  });
});

test('a row that is not an object fails mid-stream, and the lines already streamed stay', async () => {
  await expect(run(['mixed', '--format', 'jsonl', '--fields', 'name'])).resolves.toEqual({
    status: 2,
    stderr: failureLine(
      'mixed',
      'Option "--fields" selects fields of objects, but the output holds a number. Remove the option.',
    ),
    stdout: '{"name":"a"}\n',
  });
});

test('--fields under a view that is neither json nor jsonl fails and says where it applies', async () => {
  await expect(run(['get', '--fields', 'name'])).resolves.toEqual({
    status: 2,
    stderr:
      'app: Option "--fields" applies only to the json and jsonl output the formatter provides. Remove the option, or select json or jsonl with "--format".\nRun "app get --help" to see the usage.\n',
    stdout: '',
  });
  const rows = await run(['list', '--fields', 'name']);
  expect(rows.status).toBe(2);
  expect(rows.stdout).toBe('');
});

test('in an invocation by name, a --fields failure names the options by their declared names', async () => {
  const app = application();
  // The formatter's hook declares both options, so the types know neither, and the path is dynamic.
  const get: readonly string[] = ['get'];
  const refused = await app.invoke(
    get,
    { options: { fields: ['name'] } },
    { process: mockProcess() },
  );
  expect(refused).toMatchObject({
    exitCode: 2,
    messages:
      'app: Option "fields" applies only to the json and jsonl output the formatter provides. Remove the option, or select json or jsonl with "format".\n',
    status: 'failed',
  });
  const unknown = await app.invoke(
    get,
    { options: { fields: ['color'], format: 'json' } },
    { process: mockProcess() },
  );
  expect(unknown).toMatchObject({
    messages:
      'app: Option "fields" names "color", which the output does not hold. Supply fields from name, owner, size.\n',
    status: 'failed',
  });
  const failure = unknown.status === 'failed' ? unknown.failure : undefined;
  expect(failure instanceof InputError ? failure.problems : failure).toMatchObject([
    { input: { kind: 'option', name: 'fields' }, reason: 'invalid', spelling: 'fields' },
  ]);
});

test('an empty field name fails at validation', async () => {
  const { status, stderr } = await run(['get', '--format', 'json', '--fields', 'name,']);
  expect(status).toBe(2);
  expect(stderr).toContain('Supply field names separated by commas, such as name,size.');
});

test('without --fields every byte is unchanged', async () => {
  await expect(run(['get', '--format', 'jsonl'])).resolves.toEqual(
    done('{"name":"a","owner":"x","size":1}\n'),
  );
});

test('--fields is a control option on the help page and in the graph', async () => {
  const page = await run(['get', '--help']);
  expect(page.stdout).toContain(
    '--fields <fields>  Select top-level fields of json and jsonl output, as a comma list.',
  );
  const get = inspect().root.children.find((child) => child.name === 'get');
  expect(get?.options.find((option) => option.name === 'fields')).toMatchObject({
    control: true,
    hidden: false,
  });
});

test('on a group --fields is hidden, and the run fails with the missing subcommand as under --format', async () => {
  const cache = inspect().root.children.find((child) => child.name === 'cache');
  expect(cache?.options.find((option) => option.name === 'fields')).toMatchObject({
    control: true,
    hidden: true,
  });
  const fields = await run(['cache', '--fields', 'name']);
  const plain = await run(['cache']);
  expect(fields).toEqual(plain);
  expect(fields.status).toBe(2);
  await expect(run(['cache', 'clear', '--format', 'jsonl', '--fields', 'name'])).resolves.toEqual(
    done('{"name":"a"}\n'),
  );
});

test("a Command's own fields option is the hook-collision fault", () => {
  expect(buildInspect('fields-collision')).toMatchObject({
    rule: '@loomcli/core/option-declared-twice',
    sentence:
      'Plugin "@loomcli/plugins/format" declares option "fields" on Command "count", which is already declared as a local option.',
  });
});

test.each(['mapped', 'unmapped', 'jsonl'])(
  '--fields refuses an author-declared %s view before the action or map runs',
  async (kind) => {
    const mapped: unknown[] = [];
    let acted = false;
    const app = new Application('app', { plugins: [format()] }).command(
      new Command('get')
        .result<{ id: number; name: string }>({
          views: {
            text: { render: () => 'text\n' },
            ...(kind === 'jsonl'
              ? { jsonl: jsonl() }
              : {
                  json:
                    kind === 'mapped'
                      ? json({
                          map: (value) => {
                            mapped.push(value);
                            return { title: value.name.toUpperCase() };
                          },
                        })
                      : json(),
                }),
          },
        })
        .action(({ out }) => {
          acted = true;
          return out.results({ id: 1, name: 'a' });
        }),
    );
    const result = await runOnMock(app, {
      argv: ['get', '--format', kind === 'jsonl' ? 'jsonl' : 'json', '--fields', 'id'],
      release: { build: 'distributed' },
    });
    const refusal =
      kind === 'jsonl'
        ? 'Option "--fields" applies only to the json output the formatter provides. Remove the option, or select json with "--format".'
        : 'Option "--fields" applies only to the jsonl output the formatter provides. Remove the option, or select jsonl with "--format".';
    expect(result).toEqual({
      status: 2,
      stderr: `{"error":{"code":"invalid-input","exitCode":2,"message":${JSON.stringify(refusal)},"hints":[]}}\n`,
      stdout: '',
    });
    expect(acted).toBe(false);
    expect(mapped).toEqual([]);
    const selected = await runOnMock(app, {
      argv: ['get', '--format', kind === 'jsonl' ? 'json' : 'jsonl', '--fields', 'name'],
      release: { build: 'distributed' },
    });
    expect(selected).toEqual(done(kind === 'jsonl' ? '{\n  "name": "a"\n}\n' : '{"name":"a"}\n'));
  },
);

/** The JSON views the author declares on `declaring`'s `get`. */
type Declared = 'both' | 'json' | 'jsonl';

/** An application, with help and the formatter, whose `get` declares the JSON views `declared` names. */
function declaring(declared: Declared) {
  const views = {
    text: { render: () => 'text\n' },
    ...(declared === 'jsonl' ? {} : { json: json() }),
    ...(declared === 'json' ? {} : { jsonl: jsonl() }),
  };
  return new Application('app', { plugins: [help(), format()] }).command(
    new Command('get')
      .result<{ id: number }>({ views })
      .action(({ out }) => out.results({ id: 1 })),
  );
}

test('a Command whose json and jsonl views the author declares has no --fields', async () => {
  const app = declaring('both');
  const get = app.inspect().root.children.find((child) => child.name === 'get');
  const names = get?.options.map((option) => option.name);
  expect(names).toContain('format');
  expect(names).not.toContain('fields');
  const page = await runOnMock(app, { argv: ['get', '--help'], release: { build: 'distributed' } });
  expect(page.stdout).toContain('--format <format>');
  expect(page.stdout).not.toContain('--fields');
  for (const view of ['json', 'jsonl']) {
    await expect(
      runOnMock(app, {
        argv: ['get', '--format', view, '--fields', 'id'],
        release: { build: 'distributed' },
      }),
    ).resolves.toEqual({
      status: 2,
      stderr: `{"error":{"code":"unknown-option","exitCode":2,"message":${JSON.stringify('Unknown option "--fields". Supply a declared option; prefix a hyphenated path with "./".')},"hints":[${JSON.stringify('Run "app get --help" to see the usage.')}]}}\n`,
      stdout: '',
    });
  }
});

test.each(['json', 'jsonl'] as const)(
  'a Command whose %s view alone the author declares keeps --fields',
  async (declared) => {
    const app = declaring(declared);
    const get = app.inspect().root.children.find((child) => child.name === 'get');
    expect(get?.options.find((option) => option.name === 'fields')).toMatchObject({
      control: true,
      hidden: false,
    });
    const page = await runOnMock(app, {
      argv: ['get', '--help'],
      release: { build: 'distributed' },
    });
    expect(page.stdout).toContain('--fields <fields>');
  },
);

test('the formatter leaves alone a fields option of a Command whose json and jsonl the author declares', async () => {
  const supplied: unknown[] = [];
  const app = new Application('app', { plugins: [format()] }).command(
    new Command('get')
      .option('fields', { type: 'string' })
      .result<{ id: number }>({ views: { json: json(), jsonl: jsonl() } })
      .action(({ options, out }) => {
        supplied.push(options.fields);
        return out.results({ id: 1 });
      }),
  );
  await expect(
    runOnMock(app, {
      argv: ['get', '--format', 'jsonl', '--fields', 'name'],
      release: { build: 'distributed' },
    }),
  ).resolves.toEqual(done('{"id":1}\n'));
  expect(supplied).toEqual(['name']);
});

test('a held missing required option ranks ahead of --fields under the default text view', async () => {
  const app = new Application('app', { plugins: [format()] }).command(
    new Command('get')
      .option('file', { required: true, type: 'string' })
      .result<{ id: number }>({ views: { text: { render: () => 'text\n' } } })
      .action(({ out }) => out.results({ id: 1 })),
  );
  await expect(
    runOnMock(app, {
      argv: ['get', '--fields', 'zz'],
      release: { build: 'distributed' },
    }),
  ).resolves.toEqual({
    status: 2,
    stderr: 'app: Option "--file" is required. Supply a value.\n',
    stdout: '',
  });
});
