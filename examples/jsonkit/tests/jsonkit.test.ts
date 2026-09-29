import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { document, main, withDocuments } from './documents.js';

/** The fix a parse failure ends with, as a pattern, after the parser's own reason. */
const parseFix = String.raw`Correct its syntax, or supply another document\.`;

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

test('jsonkit preserves JSON strings that resemble recognized style markup', () => {
  const literal = '\uE000["style",[["foreground","red"]]]\uE001data\uE002';
  const contents = JSON.stringify({ value: literal });
  const result = invoke(main, ['get', 'value'], { input: contents });
  expect(result).toEqual({ status: 0, stderr: '', stdout: `${JSON.stringify(literal)}\n` });
});

test('jsonkit quotes an unresolved path and escapes its bidirectional controls', () => {
  const override = '\u{202e}';
  const cases: [string, string][] = [
    ['name.', 'name.'],
    [`a${override}b`, String.raw`a\u202eb`],
  ];
  for (const [path, shown] of cases) {
    expect(invoke(main, ['get', path], { input: '{"name": "loom"}' })).toEqual({
      status: 65,
      stderr: `Path not found: "${shown}". Run jsonkit keys to list the keys at the root.\n`,
      stdout: '',
    });
  }
});

test('jsonkit renders document error messages literally', () => {
  const path = '\uE000["style",[["foreground","red"]]]\uE001missing\uE002';
  for (const command of ['get', 'keys']) {
    expect(invoke(main, [command, path], { input: '{}' })).toEqual({
      status: 65,
      stderr: `Path not found: "${path}". Run jsonkit keys to list the keys at the root.\n`,
      stdout: '',
    });
  }
  expect(invoke(main, ['keys', path], { input: JSON.stringify({ [path]: 1 }) })).toEqual({
    status: 1,
    stderr: `Expected an object at ${path}; found number. Run jsonkit paths to find the paths that hold objects.\n`,
    stdout: '',
  });
});

test('jsonkit summarizes an object with one kind line per key', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json'], { cwd })).toEqual({
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
])('jsonkit summarizes %s as an empty records result beside its kind line', (contents, kind) => {
  withDocuments({ 'doc.json': contents }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: kindLine(kind),
      stdout: '0 records\n',
    });
  });
});

test.each([
  ['nested.deep.value', '"found"\n'],
  ['tags.1', '"b"\n'],
  ['count', '3\n'],
  ['none', 'null\n'],
  ['nested.deep', '{\n  "value": "found"\n}\n'],
  ['tags', '[\n  "a",\n  "b"\n]\n'],
])('jsonkit prints the JSON text at %s', (path, stdout) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['--file', 'doc.json', 'get', path], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout,
    });
  });
});

test.each(['missing', 'nested.missing', 'tags.2', 'name.length', 'tags.first'])(
  'jsonkit reports the unresolved path %s with EX_DATAERR',
  (path) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, ['get', path, '--file', 'doc.json'], { cwd })).toEqual({
        status: 65,
        stderr: `Path not found: "${path}". Run jsonkit keys to list the keys at the root.\n`,
        stdout: '',
      });
    });
  },
);

test('jsonkit lists the keys of an object in JavaScript property order', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['keys', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: 'name\ntags\nnested\ncount\nok\nnone\n',
    });
  });
});

test('jsonkit ls lists the keys the way jsonkit keys does', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['ls', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: 'name\ntags\nnested\ncount\nok\nnone\n',
    });
  });
});

test('jsonkit fetch reads the value the way jsonkit get does', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['fetch', 'nested.deep.value', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '"found"\n',
    });
  });
});

test('jsonkit debug prints the whole parsed document as indented JSON', () => {
  withDocuments({ 'doc.json': '{"name":"loom","tags":["a"]}' }, (cwd) => {
    expect(invoke(main, ['debug', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '{\n  "name": "loom",\n  "tags": [\n    "a"\n  ]\n}\n',
    });
  });
});

test('jsonkit lists integer-like keys first, as JavaScript orders them', () => {
  withDocuments({ 'doc.json': '{"b": 1, "2": 2, "a": 3}' }, (cwd) => {
    expect(invoke(main, ['keys', '--file', 'doc.json'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '2\nb\na\n',
    });
  });
});

test('jsonkit prints nothing for the keys of an empty object', () => {
  withDocuments({ 'doc.json': '{}' }, (cwd) => {
    expect(invoke(main, ['keys', '--file', 'doc.json'], { cwd })).toEqual({
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
])('jsonkit rejects keys on the non-object root %s', (contents, kind) => {
  withDocuments({ 'doc.json': contents }, (cwd) => {
    expect(invoke(main, ['keys', '-f', 'doc.json'], { cwd })).toEqual({
      status: 1,
      stderr: `Expected an object at the root; found ${kind}. Run jsonkit paths to find the paths that hold objects.\n`,
      stdout: '',
    });
  });
});

test.each([[[]], [['get', 'name']], [['keys']]])(
  'jsonkit reports a read failure for %j',
  (args) => {
    const result = invoke(main, ['--file', 'missing.json', ...args]);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Cannot read file: missing.json: ');
    expect(result.stderr).toContain('ENOENT');
    expect(result.stderr).toMatch(/[^.]\. Supply a readable file, or pipe JSON to stdin\.\n$/u);
  },
);

test.each([
  ['malformed.json', '{"name":'],
  ['empty.json', ''],
  ['text.json', 'not json at all'],
])('jsonkit reports a parse failure for %s', (file, contents) => {
  withDocuments({ [file]: contents }, (cwd) => {
    const result = invoke(main, ['--file', file], { cwd });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(
      new RegExp(`^Cannot parse JSON in ${file}: .+[^.]\\. ${parseFix}\\n$`, 'u'),
    );
  });
});

test.each([
  [[], summary, kindLine('object with 6 keys')],
  [['get', 'name'], '"loom"\n', ''],
  [['keys'], 'name\ntags\nnested\ncount\nok\nnone\n', ''],
  [['select', '--field', 'name'], '{\n  "name": "loom"\n}\n', ''],
] satisfies [string[], string, string][])(
  'jsonkit reads the piped document for %j',
  (args, stdout, stderr) => {
    expect(invoke(main, args, { input: document })).toEqual({ status: 0, stderr, stdout });
  },
);

test.each(['', '{"name":', 'not json at all'])(
  'jsonkit reports a parse failure for the piped text %j',
  (input) => {
    const result = invoke(main, [], { input });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(
      new RegExp(`^Cannot parse JSON in stdin: .+[^.]\\. ${parseFix}\\n$`, 'u'),
    );
  },
);

test.each([
  [['--file', 'doc.json', 'get', 'name']],
  [['get', '--file', 'doc.json', 'name']],
  [['get', 'name', '--file', 'doc.json']],
  [['get', 'name', '--file=doc.json']],
  [['-f', 'doc.json', 'get', 'name']],
])('jsonkit reads the same value for the global placement %j', (args) => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, args, { cwd })).toEqual({ status: 0, stderr: '', stdout: '"loom"\n' });
  });
});

test('jsonkit treats a route name after --file as the option value', () => {
  withDocuments({ keys: document }, (cwd) => {
    expect(invoke(main, ['--file', 'keys', 'get', 'name'], { cwd })).toEqual({
      status: 0,
      stderr: '',
      stdout: '"loom"\n',
    });
  });
});

test('jsonkit ignores a passthrough tail that repeats the file global', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(
      invoke(main, ['keys', '--file', 'doc.json', '--', '--file', 'other.json'], { cwd }),
    ).toEqual({ status: 0, stderr: '', stdout: 'name\ntags\nnested\ncount\nok\nnone\n' });
  });
});

test.each(['summary', 'typo'])(
  'jsonkit rejects the unknown command %s and lists the choices',
  (name) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, ['--file', 'doc.json', name], { cwd })).toEqual({
        status: 2,
        stderr: `jsonkit: Unknown command "${name}". Use one of: doctor, completion, get, keys, select.\nRun "jsonkit --help" to see the usage.\n`,
        stdout: '',
      });
    });
  },
);

test.each(['gets'])(
  'jsonkit rejects the unknown command %s and suggests the near match "get"',
  (name) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, ['--file', 'doc.json', name], { cwd })).toEqual({
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
  (name, sentence) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, [name, 'name', '-f', 'doc.json'], { cwd })).toEqual({
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
  (name) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      expect(invoke(main, [name, '-f', 'doc.json'], { cwd })).toEqual({
        status: 2,
        stderr: `jsonkit: Unknown command "${name}". Use one of: doctor, completion, get, keys, select.\nRun "jsonkit --help" to see the usage.\n`,
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
  (args, sentence) => {
    withDocuments({ 'doc.json': document }, (cwd) => {
      const routed = args[0];
      expect(invoke(main, args, { cwd })).toEqual({
        status: 2,
        stderr: `${sentence}Run "jsonkit ${routed} --help" to see the usage.\nRun "jsonkit ${routed} --explain" to explain this command.\n`,
        stdout: '',
      });
    });
  },
);

test('jsonkit names the omitted path argument by its own spelling', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['get', '-f', 'doc.json'], { cwd })).toEqual({
      status: 2,
      stderr:
        'jsonkit: Argument "path" requires a value. Supply a value for "path".\nRun "jsonkit get --help" to see the usage.\n',
      stdout: '',
    });
  });
});

test('jsonkit keeps the default text for a failure class it registers no view for', () => {
  withDocuments({ 'doc.json': document }, (cwd) => {
    expect(invoke(main, ['get', 'name', '-f', 'doc.json', '--pretty'], { cwd })).toEqual({
      status: 2,
      stderr:
        'jsonkit: Unknown option "--pretty". Supply a declared option; prefix a hyphenated path with "./".\nRun "jsonkit get --help" to see the usage.\nRun "jsonkit get --explain" to explain this command.\n',
      stdout: '',
    });
  });
});

test.each(['cwd', 'stdin'])(
  'jsonkit runs through a supplied host for the %s scenario',
  (scenario) => {
    expect(invoke(new URL('fixtures/host.mjs', import.meta.url), [scenario])).toEqual({
      status: 0,
      stderr: '',
      stdout: '"loom"\n',
    });
  },
);

test('jsonkit asks for a file or piped JSON when stdin is a terminal', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['terminal'])).toEqual({
    status: 2,
    stderr:
      'jsonkit: Option "--file": Supply a file or pipe JSON to stdin.\nRun "jsonkit get --help" to see the usage.\n',
    stdout: '',
  });
});

test('jsonkit reads a supplied file at a terminal, because the file answers the rule', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['terminal-file'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '"loom"\n',
  });
});

test('jsonkit reports the reason a stdin read failed', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['unreadable']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  // The reason already ends with a period, so the fix follows it with no second one.
  expect(result.stderr).toBe(
    'Cannot read stdin: The connection failed. Supply a readable file, or pipe JSON to stdin.\n',
  );
});

test('jsonkit reports a stdin connection that closed before it ended', () => {
  const result = invoke(new URL('fixtures/host.mjs', import.meta.url), ['closed-early']);
  expect(result.status).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toMatch(
    /^Cannot read stdin: .+[^.]\. Supply a readable file, or pipe JSON to stdin\.\n$/u,
  );
});

test('jsonkit never reads stdin when the file global is supplied', () => {
  expect(invoke(new URL('fixtures/host.mjs', import.meta.url), ['file-only'])).toEqual({
    status: 0,
    stderr: '',
    stdout: '"loom"\n0\treads\n',
  });
});
