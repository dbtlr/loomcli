import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function run(scenario: string, build: 'development' | 'distributed' | 'source') {
  return invoke(new URL('fixtures/builds.mjs', import.meta.url), [scenario, build]);
}

const foreignThrowBanner =
  '-- UNHANDLED EXCEPTION ----------------------------- @loomcli/core/foreign-throw\n';

test('a defect in a distributed build writes the generic message alone', () => {
  expect(run('type-error', 'distributed')).toEqual({
    status: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
});

test.each(['development', 'source'] as const)(
  "a defect in a %s build writes its Developer Diagnostic with the author's source",
  (build) => {
    const { status, stderr } = run('type-error', build);
    expect(status).toBe(1);
    expect(stderr.startsWith(foreignThrowBanner)).toBe(true);
    // The excerpt marks the frame's line and puts a caret under its column.
    // Node reports the failing read itself.
    // Bun folds `value` into `(void 0).length` and reports a line of the action at or above the read.
    // So the marked line is one of the action's, and the failing line shows in the excerpt.
    expect(stderr).toMatch(/^packages\/core\/tests\/fixtures\/builds\.mjs:6[4-6]:\d+$/mu);
    expect(stderr).toMatch(
      /^> 6[4-6] \| .*(?:\.action\(\(\) => \{|const value = undefined;|return value\.length;)$/mu,
    );
    expect(stderr).toMatch(/^(?:> | {2})66 \| {11}return value\.length;$/mu);
    expect(stderr).toMatch(/^ {5}\| +\^$/mu);
    expect(stderr).toMatch(/^TypeError: .+$/mu);
    expect(stderr).toMatch(/^ {4}at .+builds\.mjs:6\d:\d+\)?$/mu);
    expect(stderr).toContain(
      '\n\nCatch the error where it is thrown and throw a failure class, such as FatalError, with a sentence the operator can act on.\n',
    );
    expect(stderr).not.toContain('Something went wrong');
  },
);

test('a cause chain of two prints both, and a thrown value that is not an Error prints as a value', () => {
  const chain = run('chain', 'development').stderr;
  expect(chain).toMatch(/^Error: Outer\.\n(?: {4}at .+\n)+Caused by SyntaxError: Inner\.$/mu);
  expect(run('thrown-string', 'development').stderr).toContain("\n\nThrown value: 'a\\u2028b'\n\n");
});

test('a cause message prints its line breaks, bidirectional controls, and separators escaped', () => {
  const { stderr } = run('escaped', 'development');
  expect(stderr).toContain('\nError: line\\u000abreak \\u202e bidi \\u2028 separator\n');
  expect(stderr).not.toMatch(/[\u202e\u2028]/u);
});

test("an application's and a plugin's override of InternalError render a defect when distributed and are passed over in development", () => {
  expect(run('app-override', 'distributed').stderr).toBe('application override\n');
  expect(run('plugin-override', 'distributed').stderr).toBe('plugin override\n');
  for (const scenario of ['app-override', 'plugin-override']) {
    const { status, stderr } = run(scenario, 'development');
    expect(status).toBe(1);
    expect(stderr.startsWith(foreignThrowBanner)).toBe(true);
    expect(stderr).not.toMatch(/^(?:application|plugin) override$/mu);
  }
});

test('an onFailure hint prints under the generic message and under the Developer Diagnostic', () => {
  expect(run('hint', 'distributed').stderr).toBe(
    'probe: Something went wrong.\nReport this at https://example.com/issues.\n',
  );
  expect(run('hint', 'development').stderr).toMatch(
    /in its place\.\n\nCatch[^\n]+\n\nReport this at https:\/\/example\.com\/issues\.\n$/u,
  );
});

test('a build fault writes the generic message when distributed and its diagnostic in development, and inspect() throws it from source', () => {
  expect(run('build-fault', 'distributed')).toEqual({
    status: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
  expect(run('build-fault', 'development')).toEqual({
    status: 1,
    stderr: [
      '-- NOTHING TO RUN ------------------------- @loomcli/core/command-without-action',
      '',
      'The root Command has no action.',
      '',
      "Routing ends at a Command that runs its action, or passes on to one of a group's",
      'children. A Command with neither leaves an invocation that reaches it nothing to',
      'run.',
      '',
      'Register an action.',
      '',
    ].join('\n'),
    stdout: 'resolved:1\n',
  });
  expect(run('inspect', 'source').stdout).toBe(
    'thrown: DeclarationError: The root Command has no action.\n',
  );
});

test('a declaration fault run() reports opens its findings with the application name before the path', () => {
  expect(run('thrown-declaration', 'development').stderr).toBe(
    [
      '-- RETRY LIMIT OUT OF RANGE ---------------------------- @acme/retry/retry-limit',
      '',
      'retry() received 50 retries.',
      '',
      '    // probe get',
      "    new Command('get')",
      '      .retry(50)',
      '             ^^',
      '',
      'The plugin accepts from 0 through 10 retries.',
      '',
      'Pass a whole number from 0 through 10.',
      '',
    ].join('\n'),
  );
  expect(run('thrown-declaration', 'distributed').stderr).toBe('probe: Something went wrong.\n');
});

const missingName = 'probe: Argument "name" requires a value. Supply a value for "name".\n';

test("a broken failure view writes the failure's own text, then the generic message or the broken contract's diagnostic", () => {
  expect(run('broken-view', 'distributed')).toEqual({
    status: 1,
    stderr: `${missingName}probe: Something went wrong.\n`,
    stdout: 'resolved:1\n',
  });
  const { status, stderr } = run('broken-view', 'development');
  expect(status).toBe(1);
  expect(stderr).toMatch(
    /^probe: Argument "name" requires a value\. Supply a value for "name"\.\n\n-- BROKEN FAILURE VIEW -+ @loomcli\/core\/broken-failure-view\n\nRendering the failure failed: View broke\.\n/u,
  );
  expect(stderr).toMatch(/^> 1\d\d \| +throw new Error\('View broke\.'\);$/mu);
});

test("a broken onFailure hook writes the generic message once, or the hook's diagnostic after the failure and the other hints", () => {
  expect(run('broken-hook', 'distributed').stderr).toBe(
    `${missingName}Report this at https://example.com/issues.\nprobe: Something went wrong.\n`,
  );
  const { status, stderr } = run('broken-hook', 'development');
  expect(status).toBe(1);
  expect(stderr).toMatch(
    /^probe: Argument[^\n]+\nReport this at https:\/\/example\.com\/issues\.\n\n-- BROKEN FAILURE HOOK -+ @loomcli\/core\/broken-failure-hook\n\nPlugin "@acme\/broken-hook" failed in onFailure: Hook broke\.\n/u,
  );
  expect(stderr).toMatch(/^> 4\d \| {5}throw new Error\('Hook broke\.'\);$/mu);
});

test('a broken view beside a broken hook writes one generic line when distributed and one diagnostic per contract in development', () => {
  expect(run('broken-both', 'distributed').stderr).toBe(
    `${missingName}probe: Something went wrong.\n`,
  );
  const { stderr } = run('broken-both', 'development');
  const view = stderr.indexOf('-- BROKEN FAILURE VIEW');
  const hook = stderr.indexOf('-- BROKEN FAILURE HOOK');
  expect(view).toBeGreaterThan(0);
  expect(hook).toBeGreaterThan(view);
});

test('a broken hook in a run a caller cancelled keeps the signal code in both builds', () => {
  expect(run('broken-cancelled', 'distributed')).toEqual({
    status: 130,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'resolved:130\n',
  });
  const { status, stderr } = run('broken-cancelled', 'development');
  expect(status).toBe(130);
  expect(stderr).toContain('-- BROKEN FAILURE HOOK');
});

test('a broken output view is a defect by build', () => {
  expect(run('broken-output', 'distributed').stderr).toBe('probe: Something went wrong.\n');
  expect(run('broken-output', 'development').stderr).toMatch(
    /^-- BROKEN OUTPUT VIEW -+ @loomcli\/core\/broken-output-view\n\nRendering output failed: Output view broke\.\n/u,
  );
});

test('a forged frame outside the working directory is never read and prints its location alone', () => {
  const { stderr, stdout } = run('forged-outside', 'development');
  expect(stdout).toBe('resolved:1\n');
  expect(stderr).toContain('\n\n/elsewhere/secret.js:3:5\n\nError: Forged.\n');
});

test('a frame whose file the reader cannot answer, or whose reader throws, prints its location alone', () => {
  const missing = run('forged-missing', 'development');
  expect(missing.stdout).toMatch(/^resolved:1\nasked:.+no-such-file\.mjs\n$/u);
  expect(missing.stderr).toContain('\n\nno-such-file.mjs:3:5\n\nError: Forged.\n');
  const throwing = run('reader-throws', 'development');
  expect(throwing.stdout).toMatch(/^resolved:1\nasked:.+builds\.mjs\n$/u);
  expect(throwing.stderr).toContain('\n\nbuilds.mjs:3:5\n\nError: Forged.\n');
});

test('a frame inside node_modules is passed over for the next qualifying one', () => {
  const { stderr, stdout } = run('node-modules', 'development');
  expect(stdout).toMatch(/^resolved:1\nasked:[^,]+source\.mjs\n$/u);
  expect(stderr).toContain(
    [
      'modules/source.mjs:3:9',
      '',
      '  1 | one',
      '  2 | two',
      '> 3 | three fails here',
      '    |         ^',
      '  4 | four',
      '  5 | five',
      '',
    ].join('\n'),
  );
});

test('a frame named by a file URL reads its file', () => {
  expect(run('file-url', 'development').stderr).toContain(
    [
      'modules/source.mjs:2:1',
      '',
      '  1 | first',
      '> 2 | second',
      '    | ^',
      '  3 | third',
      '',
    ].join('\n'),
  );
});

test('a distributed build never calls the reader', () => {
  for (const scenario of ['forged-missing', 'reader-throws', 'node-modules', 'file-url']) {
    expect(run(scenario, 'distributed').stdout).toBe('resolved:1\n');
  }
});

test('the captured reader refuses a link that leaves the working directory, a path that is not a regular file, and a file over 1 MiB', () => {
  expect(JSON.parse(run('captured-reader', 'development').stdout)).toEqual({
    escape: null,
    large: null,
    outside: null,
    own: 'throw new Error("own");\n',
    pipe: null,
  });
});

test('a working directory the host names through a symbolic link still shows the author its source', () => {
  const { stderr } = run('linked-cwd', 'source');
  // Node and Bun place the throw's column differently, so the column is any number.
  expect(stderr).toMatch(
    /\n\nfails\.mjs:2:\d+\n\n {2}1 \| export function fails\(\) \{\n> 2 \| {3}throw new Error\("Linked\."\);\n/u,
  );
});

test('a message line that reads as a frame is never read as one', () => {
  const { stderr, stdout } = run('message-frame', 'development');
  // The reader is asked for the real frame's file alone, never the file the message names.
  expect(stdout).toMatch(/^resolved:1\nasked:[^,\n]+builds\.mjs\n$/u);
  expect(stderr).not.toMatch(/^ {4}at [^\n]*secret\.txt/mu);
  expect(stderr).toMatch(/^builds\.mjs:\d+:\d+$/mu);
});

test.each([
  ['spaced-frame', 'dir with space'],
  ['parenthesized-frame', 'dir (x)'],
])('a %s names its whole file, and its source prints', (scenario, directory) => {
  const { stderr, stdout } = run(scenario, 'development');
  expect(stdout).toContain(`/${directory}/src.mjs\n`);
  expect(stderr).toContain(
    [`${directory}/src.mjs:3:9`, '', '  1 | one', '  2 | two', '> 3 | three fails here', ''].join(
      '\n',
    ),
  );
});

test('a thrown revoked proxy is a foreign throw that prints as a value', () => {
  expect(run('revoked-proxy', 'distributed').stderr).toBe('probe: Something went wrong.\n');
  const { status, stderr } = run('revoked-proxy', 'development');
  expect(status).toBe(1);
  expect(stderr.startsWith(foreignThrowBanner)).toBe(true);
  expect(stderr).toContain('\n\nThrown value: …\n\n');
});

test('two defects in one run write the generic message once, or two diagnostics a blank line apart', () => {
  expect(run('two-defects', 'distributed')).toEqual({
    status: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
  const { stderr } = run('two-defects', 'development');
  const banners = [...stderr.matchAll(/^-- [A-Z]/gmu)].map((match) => match.index);
  expect(banners).toHaveLength(2);
  expect(banners[0]).toBe(0);
  expect(stderr.slice(0, banners[1]).endsWith('.\n\n')).toBe(true);
});

test('a destination that fails a write is a defect by build', () => {
  expect(run('broken-destination', 'distributed')).toEqual({
    status: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
  const { status, stderr } = run('broken-destination', 'development');
  expect(status).toBe(1);
  expect(stderr).toMatch(
    /^-- BROKEN DESTINATION -+ @loomcli\/core\/broken-destination\n\nCould not write invocation output\.\n/u,
  );
  expect(stderr).toContain('Error: The reader went away.\n');
  expect(stderr).not.toContain('Internal error');
});

test('a DeclarationError thrown in an onFailure hook or a plugin loader reads as its sentence', () => {
  const hook = run('hook-declaration', 'development').stderr;
  expect(hook).toContain('\n\nPlugin "@acme/hook" failed in onFailure: A sentence-only fault.\n');
  expect(hook).toContain('\nDeclarationError: A sentence-only fault.\n');
  const loader = run('loader-declaration', 'development').stderr;
  expect(loader).toContain(
    '\n\nLoading plugin "@acme/lazy" failed: retry() received 50 retries.\n',
  );
  expect(loader).toContain('\nDeclarationError: retry() received 50 retries.\n');
  for (const stderr of [hook, loader]) {
    expect(stderr).not.toContain(String.raw`\u000a`);
  }
});

test.each([
  [
    'loader-rejects',
    'PLUGIN LOADER FAILED',
    '@loomcli/core/plugin-loader-failed',
    'Loading plugin "@acme/lazy" failed: Cannot load.',
  ],
  [
    'next-twice',
    'NEXT() MISUSED',
    '@loomcli/core/next-misuse',
    'Plugin "@acme/twice" called next() twice.',
  ],
  [
    'unconstructed',
    'FAILURE NEVER CONSTRUCTED',
    '@loomcli/core/unconstructed-failure',
    'A thrown value inherits from a failure class but was never constructed as one.',
  ],
  [
    'not-a-signal',
    'INVALID RUN OPTIONS',
    '@loomcli/core/run-options',
    'run() received a signal that is not an AbortSignal.',
  ],
  [
    'foreign-graph',
    'GRAPH NOT FROM INSPECT()',
    '@loomcli/core/foreign-graph',
    'The graph was not produced by inspect().',
  ],
  [
    'result-missing',
    'RESULT CONTRACT BROKEN',
    '@loomcli/core/result-contract',
    'The root Command declares a result and its action returned without emitting one. Call out.results() once.',
  ],
])('%s is a defect under its own rule by build', (scenario, headline, identity, sentence) => {
  expect(run(scenario, 'distributed')).toEqual({
    status: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
  const { status, stderr } = run(scenario, 'development');
  expect(status).toBe(1);
  expect(stderr).toMatch(
    new RegExp(`^-- ${headline.replaceAll(/[()]/gu, String.raw`\$&`)} -+ ${identity}\n\n`, 'u'),
  );
  expect(stderr).toContain(`\n\n${sentence}\n`);
});
