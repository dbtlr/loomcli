import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function run(scenario: string, argv: string[] = []) {
  return invoke(new URL('fixtures/hints.mjs', import.meta.url), [scenario, ...argv]);
}

const unknownBogus =
  'Invalid input: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n';

/** The context one failure view read, which the `where` override serializes as one line. */
function seen(argv: string[], scenario = 'context') {
  const result = run(scenario, argv);
  return { context: JSON.parse(result.stderr), stdout: result.stdout };
}

test('a global-option fault in the pre-scan reads the application name and an empty path', () => {
  expect(seen(['--file']).context).toEqual({
    application: 'store',
    hints: [],
    name: 'MissingValueError',
    path: [],
  });
});

test('a local-option fault on a nested Command reads its routed path', () => {
  expect(seen(['cache', 'clear', '--bogus']).context).toEqual({
    application: 'store',
    hints: [],
    name: 'UnknownOptionError',
    path: ['cache', 'clear'],
  });
});

test('an unknown Command under a group reads the partial path to the group', () => {
  expect(seen(['cache', 'nope']).context).toEqual({
    application: 'store',
    hints: [],
    name: 'UnknownCommandError',
    path: ['cache'],
  });
});

test('an alias reports its Command canonical name in the path', () => {
  expect(seen(['cache', 'ls', '--bogus']).context.path).toEqual(['cache', 'list']);
});

test('a build fault reads the application name, an empty path, and no hints, and calls no hook', () => {
  expect(seen([], 'build-fault')).toEqual({
    context: { application: 'store', hints: [], name: 'DeclarationError', path: [] },
    stdout: 'resolved:1\n',
  });
});

test('a declared default its validator rejects calls the hook with an empty path at the root', () => {
  const result = run('default-rejected');
  expect(result.stdout).toBe('hook:fixture/one:DeclarationError:[]\nresolved:1\n');
  expect(result.stderr).toBe(
    'Invalid declaration: Option "level" has an invalid default. Fix the default or its validator.\nOption "level": No.\ncommand at []\n',
  );
});

test('a fault reported after the primary outcome receives hook calls of its own', () => {
  const result = run('after-primary');
  expect(result).toEqual({
    status: 1,
    stderr:
      'The action failed.\nhint for FatalError\nInternal error: Plugin "fixture/twice" called next() twice.\nhint for InternalError\n',
    stdout: 'hook:fixture/one:FatalError:[]\nhook:fixture/one:InternalError:[]\nresolved:1\n',
  });
});

test('a JavaScript hook that assigns exitCode leaves the resolved code alone', () => {
  expect(run('assigns-exit-code', ['cache', 'clear', '--bogus'])).toEqual({
    status: 2,
    stderr: `${unknownBogus}hinted\n`,
    stdout: 'hook:fixture/one:UnknownOptionError:[cache,clear]\nresolved:2\n',
  });
});

test('a hook reads the same graph a middleware read, built once for the run', () => {
  expect(run('shared-graph').stderr).toBe('The action failed.\nsame graph: true\n');
});

test("two plugins' hints print under core's default text in installation order, a shared line twice", () => {
  expect(run('two-plugins', ['cache', 'clear', '--bogus'])).toEqual({
    status: 2,
    stderr: `${unknownBogus}first\nshared\nshared\n`,
    stdout:
      'hook:fixture/one:UnknownOptionError:[cache,clear]\nhook:fixture/two:UnknownOptionError:[cache,clear]\nresolved:2\n',
  });
});

test('an override receives the hints and prints them in its own form', () => {
  expect(run('override-hints', ['cache', 'clear', '--bogus']).stderr).toBe(
    'usage: Unknown option "--bogus". Supply a declared option; prefix a hyphenated path with "./".\n  (first)\n  (second)\n',
  );
});

test('a hint is marked text core resolves for stderr, not escaped text', () => {
  const escape = String.fromCodePoint(27);
  const { stderr } = run('marked-hint', ['cache', 'clear', '--bogus']);
  expect(stderr.split('\n').at(1)).toBe(`plain ${escape}[1mbold${escape}[22m`);
});

test('hooks returning undefined and [] leave the default text unchanged byte for byte', () => {
  const plain = run('plain', ['cache', 'clear', '--bogus']);
  const none = run('none', ['cache', 'clear', '--bogus']);
  expect(plain.stderr).toBe(unknownBogus);
  expect(none.stderr).toBe(plain.stderr);
  expect(none.stdout).toBe(
    'hook:fixture/one:UnknownOptionError:[cache,clear]\nhook:fixture/two:UnknownOptionError:[cache,clear]\nresolved:2\n',
  );
});

test.each([
  ['broken-throws', 'Cannot suggest.'],
  ['broken-number', 'The hook returned a value that is not a string or an array of strings.'],
  ['broken-array', 'The hook returned a value that is not a string or an array of strings.'],
  ['broken-hole', 'The hook returned a value that is not a string or an array of strings.'],
  ['broken-lying-filter', 'The hook returned a value that is not a string or an array of strings.'],
  ['broken-proxied', 'The hook returned a value that is not a string or an array of strings.'],
  ['broken-promise', 'The hook returned a promise instead of hints.'],
  ['broken-callable-thenable', 'The hook returned a promise instead of hints.'],
  ['broken-rejecting', 'The hook returned a promise instead of hints.'],
])(
  'a broken hook (%s) loses its own hints, writes its one line, and returns 1',
  (scenario, reason) => {
    const result = run(scenario, ['cache', 'clear', '--bogus']);
    expect(result.stderr).toBe(
      `${unknownBogus}still here\nInternal error: Plugin "fixture/broken" failed in onFailure: ${reason}\n`,
    );
    expect(result.stdout.split('\n').at(-2)).toBe('resolved:1');
  },
);

test.each(['lying-filter', 'proxied'])(
  'a returned array (%s) contributes the strings it holds, whatever its own methods answer',
  (scenario) => {
    expect(run(scenario, ['cache', 'clear', '--bogus'])).toEqual({
      status: 2,
      stderr: `${unknownBogus}held\nstill here\n`,
      stdout:
        'hook:fixture/broken:UnknownOptionError:[cache,clear]\nhook:fixture/fine:UnknownOptionError:[cache,clear]\nresolved:2\n',
    });
  },
);

test.each(['getter', 'object', 'proxy', 'symbol'])(
  'a hook that throws a value whose message cannot be read (%s) writes the fixed reason and keeps the failure',
  (kind) => {
    const result = run(`broken-unreadable-${kind}`, ['cache', 'clear', '--bogus']);
    expect(result.stderr).toBe(
      `${unknownBogus}still here\nInternal error: Plugin "fixture/broken" failed in onFailure: The thrown value has no readable message.\n`,
    );
    expect(result.stdout.split('\n').at(-2)).toBe('resolved:1');
  },
);

test('a failure view that throws a value whose message cannot be read writes the fixed reason', () => {
  expect(run('broken-view-unreadable', ['cache', 'clear', '--bogus'])).toEqual({
    status: 1,
    stderr: `${unknownBogus}Internal error: Rendering the failure failed: The thrown value has no readable message.\n`,
    stdout: 'resolved:1\n',
  });
});

test.each([
  ['broken-multiline', String.raw`line one\u000aline two`],
  [
    'broken-controls',
    `red${['001b', '000d', '2028', '2029'].map((hex) => `\\u${hex}`).join('')}end`,
  ],
])(
  'a broken hook whose reason holds a line break or a control character (%s) writes one line',
  (scenario, reason) => {
    expect(run(scenario, ['cache', 'clear', '--bogus']).stderr).toBe(
      `${unknownBogus}still here\nInternal error: Plugin "fixture/broken" failed in onFailure: ${reason}\n`,
    );
  },
);

test('a broken failure view whose reason holds a line break writes one line', () => {
  expect(run('broken-view-multiline', ['cache', 'clear', '--bogus']).stderr).toBe(
    `${unknownBogus}Internal error: Rendering the failure failed: ${String.raw`line one\u000aline two`}\n`,
  );
});

test('two broken hooks write their lines in installation order', () => {
  expect(run('two-broken', ['cache', 'clear', '--bogus']).stderr).toBe(
    `${unknownBogus}still here\nInternal error: Plugin "fixture/first" failed in onFailure: First failed.\nInternal error: Plugin "fixture/second" failed in onFailure: The hook returned a value that is not a string or an array of strings.\n`,
  );
});

test('a broken hook beside a broken view writes the default text without hints, the view line, then the hook line', () => {
  const result = run('broken-view', ['cache', 'clear', '--bogus']);
  expect(result.stderr).toBe(
    `${unknownBogus}Internal error: Rendering the failure failed: Cannot render the failure.\nInternal error: Plugin "fixture/broken" failed in onFailure: Cannot suggest.\n`,
  );
  expect(result.stdout.split('\n').at(-2)).toBe('resolved:1');
});

test('plugin() rejects an onFailure that is not a function', () => {
  expect(run('not-function').stdout).toBe(
    'thrown:1: Plugin "@acme/suggest" declares onFailure that is not a function. Supply a function of the failure and its context.\n',
  );
});

test('a broken hook in a cancelled run whose failure still renders returns 130 and writes its line', () => {
  expect(run('cancelled-broken')).toEqual({
    status: 130,
    stderr:
      'The action failed.\nstill here\nInternal error: Plugin "fixture/broken" failed in onFailure: Cannot suggest.\n',
    stdout: 'hook:fixture/broken:FatalError:[]\nhook:fixture/fine:FatalError:[]\nresolved:130\n',
  });
});

test('a cancelled run that reports its cancellation silently calls no hook', () => {
  expect(run('cancelled-silent')).toEqual({ status: 130, stderr: '', stdout: 'resolved:130\n' });
});

test('a takeover of a held unknown-option fault calls no hook', () => {
  expect(run('takeover', ['cache', 'clear', '--bogus', '--help'])).toEqual({
    status: 0,
    stderr: '',
    stdout: 'help\nresolved:0\n',
  });
});

test.each([
  ['a variadic argument', ['tag', 'good', 'bad']],
  ['a multiple option', ['label', '--name', 'good', '--name', 'bad']],
])('an issue on the second value of %s keeps its own fields', (_kind, argv) => {
  const result = run('issue-fields', argv);
  expect(JSON.parse(result.stderr)).toEqual([
    { code: 'too_short', message: 'Too short.', path: [1] },
  ]);
});

test('a hook suggests a visible global or local spelling, never a hidden or deprecated one', () => {
  expect(run('candidates', ['cache', 'clear', '--bogus']).stderr).toBe(
    `${unknownBogus}options: --file -f --keep -k\n`,
  );
});

test('a hook suggests a visible child by its canonical name, never an alias', () => {
  expect(run('candidates', ['cache', 'nope']).stderr).toBe(
    'Invalid input: Unknown command "nope". Use one of: clear, list.\nchildren: clear list\n',
  );
});
