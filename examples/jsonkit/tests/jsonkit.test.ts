/*
 * Acceptance plan for the verbose plugin (docs/plugins/verbose.md#verbose-plugin).
 *
 * - jsonkit installs `verbose()` after `color()` and declares no verbose-marked or quiet-marked
 *   option of its own, and `jsonkit --help` lists `-v, --verbose...` and `-q, --quiet` with their
 *   descriptions after `--[no-]color`, in the pages The help page pins. The manifest marks them
 *   `control` with `verbose` and with `quiet`, and a fixture's unmarked counted option reads
 *   `false` for both.
 * - `jsonkit -v keys -f doc.json` and `jsonkit -vv keys -f doc.json` write the `Reading doc.json.`
 *   debug line on stderr, `jsonkit keys -f doc.json` and `jsonkit -v -q keys -f doc.json` write
 *   none, and `jsonkit -q keys -f doc.json` writes the keys on stdout and nothing on stderr. Piped,
 *   the line is `› Reading doc.json.`.
 * - An application that marks its own verbose option and installs the plugin fails with the
 *   two-marks error, and so does one that marks its own quiet option.
 * - A consumer installs the packed pack, imports `@loomcli/plugins/verbose`, compiles against its
 *   declarations, and `pnpm check:packed` resolves the subpath from the packed tarball under Node
 *   and Bun.
 */

// Acceptance plan: see packages/plugins/tests/suggestions.test.ts.
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { document, withDocuments } from './documents.js';
import { translated } from './fixtures/translated.js';
import { host, run } from './run.js';

/** The sentence jsonkit's translator reports for a document `JSON.parse` rejects. */
const invalidJson =
  'The document is not valid JSON. Correct its syntax, or supply another document.\n';

const summary = [
  'key   name',
  'kind  string',
  '',
  'key   tags',
  'kind  array with 2 items',
  '',
  'key   nested',
  'kind  object with 1 key',
  '',
  'key   count',
  'kind  number',
  '',
  'key   ok',
  'kind  boolean',
  '',
  'key   none',
  'kind  null',
  '',
  '6 records',
  '',
].join('\n');

function kindLine(kind: string): string {
  return `ℹ ${kind}\n`;
}

test('jsonkit stats depth max, three levels below the root, prints how deeply a path nests', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['stats', 'depth', 'max', '-f', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '3\n',
    });
    await expect(
      run(['stats', 'depth', 'max', 'nested', '-f', 'doc.json'], { cwd }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '2\n',
    });
  });
});

test('jsonkit preserves JSON strings that resemble recognized style markup', async () => {
  const literal = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  const contents = JSON.stringify({ value: literal });
  const result = await run(['get', 'value'], { input: contents });
  expect(result).toEqual({ status: 0, stderr: '', stdout: `${JSON.stringify(literal)}\n` });
});

test('jsonkit quotes an unresolved path and escapes its bidirectional controls', async () => {
  const override = '\u{202e}';
  const cases: [string, string][] = [
    ['name.', 'name.'],
    [`a${override}b`, String.raw`a\u202eb`],
  ];
  for (const [path, shown] of cases) {
    await expect(run(['get', path], { input: '{"name": "loom"}' })).resolves.toEqual({
      status: 65,
      stderr: `Path not found: "${shown}". Run jsonkit keys to list the keys at the root.\n`,
      stdout: '',
    });
  }
});

test('jsonkit renders document error messages literally', async () => {
  const path = '\uE000["style",[["foreground","red"]]]\uE001missing\uE002';
  for (const command of ['get', 'keys']) {
    await expect(run([command, path], { input: '{}' })).resolves.toEqual({
      status: 65,
      stderr: `Path not found: "${path}". Run jsonkit keys to list the keys at the root.\n`,
      stdout: '',
    });
  }
  await expect(run(['keys', path], { input: JSON.stringify({ [path]: 1 }) })).resolves.toEqual({
    status: 1,
    stderr: `Expected an object at ${path}; found number. Run jsonkit paths to find the paths that hold objects.\n`,
    stdout: '',
  });
});

test('jsonkit summarizes an object with one kind line per key', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['--file', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: kindLine('object with 6 keys'),
      stdout: summary,
    });
  });
});

test.each([
  ['[1,2,3]', 'array with 3 items'],
  ['[1]', 'array with 1 item'],
  ['{}', 'object with 0 keys'],
  ['"text"', 'string'],
  ['42', 'number'],
  ['true', 'boolean'],
  ['null', 'null'],
])(
  'jsonkit summarizes %s as an empty records result beside its kind line',
  async (contents, kind) => {
    await withDocuments({ 'doc.json': contents }, async (cwd) => {
      await expect(run(['--file', 'doc.json'], { cwd })).resolves.toEqual({
        status: 0,
        stderr: kindLine(kind),
        stdout: '0 records\n',
      });
    });
  },
);

test.each([
  ['nested.deep.value', '"found"\n'],
  ['tags.1', '"b"\n'],
  ['count', '3\n'],
  ['none', 'null\n'],
  ['nested.deep', '{\n  "value": "found"\n}\n'],
  ['tags', '[\n  "a",\n  "b"\n]\n'],
])('jsonkit prints the JSON text at %s', async (path, stdout) => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['--file', 'doc.json', 'get', path], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  });
});

test.each(['missing', 'nested.missing', 'tags.2', 'name.length', 'tags.first'])(
  'jsonkit reports the unresolved path %s with EX_DATAERR',
  async (path) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      await expect(run(['get', path, '--file', 'doc.json'], { cwd })).resolves.toEqual({
        status: 65,
        stderr: `Path not found: "${path}". Run jsonkit keys to list the keys at the root.\n`,
        stdout: '',
      });
    });
  },
);

test('jsonkit lists the keys of an object in JavaScript property order', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['keys', '--file', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'name\ntags\nnested\ncount\nok\nnone\n',
    });
  });
});

test('jsonkit ls lists the keys the way jsonkit keys does', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['ls', '--file', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'name\ntags\nnested\ncount\nok\nnone\n',
    });
  });
});

test('jsonkit fetch reads the value the way jsonkit get does', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(
      run(['fetch', 'nested.deep.value', '--file', 'doc.json'], { cwd }),
    ).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '"found"\n',
    });
  });
});

test('jsonkit debug prints the whole parsed document as indented JSON', async () => {
  await withDocuments({ 'doc.json': '{"name":"loom","tags":["a"]}' }, async (cwd) => {
    await expect(run(['debug', '--file', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '{\n  "name": "loom",\n  "tags": [\n    "a"\n  ]\n}\n',
    });
  });
});

test('jsonkit lists integer-like keys first, as JavaScript orders them', async () => {
  await withDocuments({ 'doc.json': '{"b": 1, "2": 2, "a": 3}' }, async (cwd) => {
    await expect(run(['keys', '--file', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '2\nb\na\n',
    });
  });
});

test('jsonkit prints nothing for the keys of an empty object', async () => {
  await withDocuments({ 'doc.json': '{}' }, async (cwd) => {
    await expect(run(['keys', '--file', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '',
    });
  });
});

test.each([
  ['[1,2,3]', 'array with 3 items'],
  ['"text"', 'string'],
  ['42', 'number'],
  ['true', 'boolean'],
  ['null', 'null'],
])('jsonkit rejects keys on the non-object root %s', async (contents, kind) => {
  await withDocuments({ 'doc.json': contents }, async (cwd) => {
    await expect(run(['keys', '-f', 'doc.json'], { cwd })).resolves.toEqual({
      status: 1,
      stderr: `Expected an object at the root; found ${kind}. Run jsonkit paths to find the paths that hold objects.\n`,
      stdout: '',
    });
  });
});

test.each([[[]], [['get', 'name']], [['keys']]])(
  'jsonkit rejects an unreadable file before action for %j',
  async (args) => {
    const result = await run(['--file', 'missing.json', ...args]);
    const command = args[0];
    const route = command ? ` ${command}` : '';
    expect(result).toEqual({
      status: 2,
      stderr: `jsonkit: Option "--file": Expected a readable file that exists.\nRun "jsonkit${route} --help" to see the usage.\n`,
      stdout: '',
    });
  },
);

test('jsonkit reports an unreadable file without echoing its control characters', async () => {
  const result = await run(['--file', 'missing\u{202e}.json', 'keys']);
  expect(result.status).toBe(2);
  expect(result.stderr).toBe(
    'jsonkit: Option "--file": Expected a readable file that exists.\nRun "jsonkit keys --help" to see the usage.\n',
  );
  expect(result.stderr).not.toContain('\u{202e}');
});

test.each([
  ['malformed.json', '{"name":'],
  ['empty.json', ''],
  ['text.json', 'not json at all'],
])('jsonkit reports a parse failure for %s as its data error', async (file, contents) => {
  await withDocuments({ [file]: contents }, async (cwd) => {
    for (const args of [
      ['--file', file],
      ['get', 'name', '-f', file],
    ]) {
      await expect(run(args, { cwd })).resolves.toEqual({
        status: 65,
        stderr: invalidJson,
        stdout: '',
      });
    }
  });
});

test.each([
  [[], summary, kindLine('object with 6 keys')],
  [['get', 'name'], '"loom"\n', ''],
  [['keys'], 'name\ntags\nnested\ncount\nok\nnone\n', ''],
  [['select', '--field', 'name'], '{\n  "name": "loom"\n}\n', ''],
] satisfies [string[], string, string][])(
  'jsonkit reads the piped document for %j',
  async (args, stdout, stderr) => {
    await expect(run(args, { input: document })).resolves.toEqual({ status: 0, stderr, stdout });
  },
);

test.each(['', '{"name":', 'not json at all'])(
  'jsonkit reports a parse failure for the piped text %j as its data error',
  async (input) => {
    for (const args of [[], ['get', 'name']]) {
      await expect(run(args, { input })).resolves.toEqual({
        status: 65,
        stderr: invalidJson,
        stdout: '',
      });
    }
  },
);

// The fixture imports jsonkit's reader and translation from source.
test('the data error keeps the SyntaxError JSON.parse threw as its cause', async () => {
  let reported = '';
  const mock = mockProcess({ stdin: '{"name":' });
  const status = await translated((line) => {
    reported += line;
  }).run({ process: mock });
  // The app itself prints nothing to stdout; the hook's line is the only text.
  expect(mock.stdout.text).toBe('');
  expect({ status, stderr: mock.stderr.text, stdout: reported }).toEqual({
    status: 65,
    stderr: invalidJson,
    stdout: 'cause:SyntaxError\n',
  });
});

test.each([
  [['--file', 'doc.json', 'get', 'name']],
  [['get', '--file', 'doc.json', 'name']],
  [['get', 'name', '--file', 'doc.json']],
  [['get', 'name', '--file=doc.json']],
  [['-f', 'doc.json', 'get', 'name']],
])(
  'jsonkit reads the same value for the local option placement and parent rebinding %j',
  async (args) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      await expect(run(args, { cwd })).resolves.toEqual({
        status: 0,
        stderr: '',
        stdout: '"loom"\n',
      });
    });
  },
);

test('jsonkit treats a route name after --file as the option value', async () => {
  await withDocuments({ keys: document }, async (cwd) => {
    await expect(run(['--file', 'keys', 'get', 'name'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '"loom"\n',
    });
  });
});

test('jsonkit ignores a passthrough tail that repeats the file option', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(
      run(['keys', '--file', 'doc.json', '--', '--file', 'other.json'], { cwd }),
    ).resolves.toEqual({ status: 0, stderr: '', stdout: 'name\ntags\nnested\ncount\nok\nnone\n' });
  });
});

test.each(['summary', 'typo'])(
  'jsonkit rejects the unknown command %s and lists the choices',
  async (name) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      await expect(run(['--file', 'doc.json', name], { cwd })).resolves.toEqual({
        status: 2,
        stderr: `jsonkit: Unknown command "${name}". Use one of: doctor, completion, mcp, manpage, get, keys, select, stats.\nRun "jsonkit --help" to see the usage.\n`,
        stdout: '',
      });
    });
  },
);

test.each(['gets'])(
  'jsonkit rejects the unknown command %s and suggests the near match "get"',
  async (name) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      await expect(run(['--file', 'doc.json', name], { cwd })).resolves.toEqual({
        status: 2,
        stderr: `jsonkit: Unknown command "${name}". Did you mean "get"?\nRun "jsonkit --help" to see the usage.\n`,
        stdout: '',
      });
    });
  },
);

test.each([
  ['gte', 'jsonkit: Unknown command "gte". Did you mean "get"?\n'],
  ['Get', 'jsonkit: Unknown command "Get". Did you mean "get"?\n'],
])(
  'jsonkit %s name -f doc.json suggests the near match and points at the help page',
  async (name, sentence) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      await expect(run([name, 'name', '-f', 'doc.json'], { cwd })).resolves.toEqual({
        status: 2,
        stderr: `${sentence}Run "jsonkit --help" to see the usage.\n`,
        stdout: '',
      });
    });
  },
);

// `lss` is near only the alias `ls`, and too far from `keys`.
// `fetc` is near only the deprecated `fetch`.
// Neither an alias nor a deprecated name is offered as the fix, so both keep the choice list.
test.each(['lss', 'fetc'])(
  'jsonkit %s -f doc.json finds no offered near match and lists the choices',
  async (name) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      await expect(run([name, '-f', 'doc.json'], { cwd })).resolves.toEqual({
        status: 2,
        stderr: `jsonkit: Unknown command "${name}". Use one of: doctor, completion, mcp, manpage, get, keys, select, stats.\nRun "jsonkit --help" to see the usage.\n`,
        stdout: '',
      });
    });
  },
);

test.each([
  [
    ['select', '--fields', 'name', '-f', 'doc.json'],
    'jsonkit: Unknown option "--fields". Did you mean "--field"?\n',
  ],
  [
    ['select', '--fiel', 'name', '-f', 'doc.json'],
    'jsonkit: Unknown option "--fiel". Did you mean one of these: --file, --field?\n',
  ],
  [
    ['get', '--hlep', 'name', '-f', 'doc.json'],
    'jsonkit: Unknown option "--hlep". Did you mean "--help"?\n',
  ],
] satisfies [string[], string][])(
  'jsonkit %j suggests the near option and points at the help and explain pages',
  async (args, sentence) => {
    await withDocuments({ 'doc.json': document }, async (cwd) => {
      const routed = args[0];
      await expect(run(args, { cwd })).resolves.toEqual({
        status: 2,
        stderr: `${sentence}Run "jsonkit ${routed} --help" to see the usage.\nRun "jsonkit ${routed} --explain" to explain this command.\n`,
        stdout: '',
      });
    });
  },
);

test('jsonkit names the omitted path argument by its own spelling', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['get', '-f', 'doc.json'], { cwd })).resolves.toEqual({
      status: 2,
      stderr:
        'jsonkit: Argument "path" requires a value. Supply a value for "path".\nRun "jsonkit get --help" to see the usage.\n',
      stdout: '',
    });
  });
});

test('jsonkit keeps the default text for a failure class it registers no view for', async () => {
  await withDocuments({ 'doc.json': document }, async (cwd) => {
    await expect(run(['get', 'name', '-f', 'doc.json', '--pretty'], { cwd })).resolves.toEqual({
      status: 2,
      stderr:
        'jsonkit: Unknown option "--pretty". Supply a declared option; prefix a hyphenated path with "./".\nRun "jsonkit get --help" to see the usage.\nRun "jsonkit get --explain" to explain this command.\n',
      stdout: '',
    });
  });
});

test.each(['cwd', 'stdin'])(
  'jsonkit runs through a supplied host for the %s scenario',
  async (scenario) => {
    await expect(host(scenario)).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: '"loom"\n',
    });
  },
);

test('jsonkit asks for a file or piped JSON when stdin is a terminal', async () => {
  await expect(host('terminal')).resolves.toEqual({
    status: 2,
    stderr:
      'jsonkit: Option "--file": Expected at least 1 readable source.\nRun "jsonkit get --help" to see the usage.\n',
    stdout: '',
  });
});

test('jsonkit reads a supplied file at a terminal, because the file answers the rule', async () => {
  await expect(host('terminal-file')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '"loom"\n',
  });
});

test('jsonkit reports the reason a stdin read failed', async () => {
  const result = await host('unreadable');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  // The reason already ends with a period, so the fix follows it with no second one.
  expect(result.stderr).toBe(
    'Cannot read stdin: The connection failed. Supply a readable file, or pipe JSON to stdin.\n',
  );
});

test('jsonkit reports a stdin connection that closed before it ended', async () => {
  const result = await host('closed-early');
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(
    /^Cannot read stdin: .+[^.]\. Supply a readable file, or pipe JSON to stdin\.\n$/u,
  );
});

test('jsonkit never reads stdin when the file option is supplied', async () => {
  await expect(host('file-only')).resolves.toEqual({
    status: 0,
    stderr: '',
    stdout: '"loom"\n0\treads\n',
  });
});

test.each([
  [['-v', 'keys', '-f', 'doc.json']],
  [['keys', '-f', 'doc.json', '-v']],
  [['-vv', 'keys', '-f', 'doc.json']],
  [['--verbose', 'keys', '-f', 'doc.json', '-v']],
])('jsonkit %j names the document on one debug line before it reads it', async (argv) => {
  await withDocuments({ 'doc.json': '{"a":1,"b":2}' }, async (cwd) => {
    await expect(run(argv, { cwd })).resolves.toEqual({
      status: 0,
      stderr: '› Reading doc.json.\n',
      stdout: 'a\nb\n',
    });
  });
});

test.each([[['keys', '-f', 'doc.json']], [['-v', '-q', 'keys', '-f', 'doc.json']]])(
  'jsonkit %j writes no debug line',
  async (argv) => {
    await withDocuments({ 'doc.json': '{"a":1}' }, async (cwd) => {
      await expect(run(argv, { cwd })).resolves.toEqual({ status: 0, stderr: '', stdout: 'a\n' });
    });
  },
);

test('jsonkit -q writes the keys on stdout and nothing on stderr', async () => {
  await withDocuments({ 'doc.json': '{"a":1}' }, async (cwd) => {
    await expect(run(['-q', 'keys', '-f', 'doc.json'], { cwd })).resolves.toEqual({
      status: 0,
      stderr: '',
      stdout: 'a\n',
    });
  });
});

test('jsonkit -q nope prints its unknown-command failure', async () => {
  const result = await run(['-q', 'nope']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain('jsonkit: Unknown command "nope".');
});

test('jsonkit -v names stdin when no file is supplied, and escapes a file name it prints', async () => {
  await expect(run(['-v', 'keys'], { input: '{"a":1}' })).resolves.toEqual({
    status: 0,
    stderr: '› Reading stdin.\n',
    stdout: 'a\n',
  });
  const name = 'doc\u{202e}.json';
  await withDocuments({ [name]: '{"a":1}' }, async (cwd) => {
    const { stderr } = await run(['-v', 'keys', '-f', name], { cwd });
    expect(stderr).toBe(`${String.raw`› Reading doc\u202e.json.`}\n`);
  });
});

test('jsonkit --verbose=2 fails with the counted unexpected-value error', async () => {
  const result = await run(['--verbose=2', 'keys']);
  expect(result.status).toBe(2);
  expect(result.stderr).toContain(
    'jsonkit: Counted option "--verbose" does not accept a value. Repeat "--verbose" to raise its count.\n',
  );
  const { stderr } = await run(['-v2', 'keys']);
  expect(stderr).toContain('jsonkit: Unknown option "-2".');
});
