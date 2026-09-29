import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

function run(scenario: string, build: 'development' | 'distributed' | 'none') {
  return invoke(new URL('fixtures/builds.mjs', import.meta.url), [scenario, build]);
}

const foreignThrowBanner =
  '-- UNHANDLED EXCEPTION ----------------------------- @loomcli/core/foreign-throw\n';

test.each(['distributed', 'none'] as const)(
  'a defect in a %s build writes the generic message alone',
  (build) => {
    expect(run('type-error', build)).toEqual({
      status: 1,
      stderr: 'probe: Something went wrong.\n',
      stdout: 'resolved:1\n',
    });
  },
);

test("a defect in a development build writes its Developer Diagnostic with the author's source", () => {
  const { status, stderr } = run('type-error', 'development');
  expect(status).toBe(1);
  expect(stderr.startsWith(foreignThrowBanner)).toBe(true);
  // The excerpt marks the failing line and puts a caret under the frame's column.
  expect(stderr).toMatch(/^packages\/core\/tests\/fixtures\/builds\.mjs:6\d:\d+$/mu);
  expect(stderr).toMatch(/^> 6\d \| {11}(?:const value = undefined;|return value\.length;)$/mu);
  expect(stderr).toMatch(/^ {5}\| +\^$/mu);
  expect(stderr).toMatch(/^TypeError: .+$/mu);
  expect(stderr).toMatch(/^ {4}at .+builds\.mjs:6\d:\d+\)?$/mu);
  expect(stderr).toContain(
    '- Register a translator for its class with translate(ErrorClass, translator).\n',
  );
  expect(stderr).not.toContain('Something went wrong');
});

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
    /in its place\.\n\n- Catch[^\n]+\n- Register[^\n]+\n\nReport this at https:\/\/example\.com\/issues\.\n$/u,
  );
});

test('a build fault writes the generic message when distributed and its diagnostic in development, and inspect() throws it in both', () => {
  expect(run('build-fault', 'distributed')).toEqual({
    status: 1,
    stderr: 'probe: Something went wrong.\n',
    stdout: 'resolved:1\n',
  });
  expect(run('build-fault', 'development')).toEqual({
    status: 1,
    stderr: [
      '-- INVALID DECLARATION ---------------------------------------------------------',
      '',
      'The root Command has no action. Register an action.',
      '',
    ].join('\n'),
    stdout: 'resolved:1\n',
  });
  for (const build of ['development', 'distributed'] as const) {
    expect(run('inspect', build).stdout).toBe(
      'thrown: DeclarationError: The root Command has no action. Register an action.\n',
    );
  }
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
  expect(stderr).toMatch(/^> 44 \| {5}throw new Error\('Hook broke\.'\);$/mu);
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

test('the captured reader refuses a link under the working directory that leaves it', () => {
  expect(JSON.parse(run('captured-reader', 'development').stdout)).toEqual({
    escape: null,
    outside: null,
    own: 'throw new Error("own");\n',
  });
});

test.each([
  [
    'packet-staging',
    'thrown: The packet\'s build is "staging". Set build to "development" or "distributed".\n',
  ],
  [
    'packet-missing',
    'thrown: The packet has no build. Set build to "development" or "distributed".\n',
  ],
  [
    'packet-not-object',
    'thrown: The Application packet must be an object. Import loom.packet.json and pass it as packet.\n',
  ],
])('the Application constructor rejects %s', (scenario, stdout) => {
  expect(run(scenario, 'none').stdout).toBe(stdout);
});

test('a packet with an extra member reads as its build, and a later change to the imported object changes no run', () => {
  expect(run('packet-extra', 'none').stderr).toBe('probe: Something went wrong.\n');
  expect(run('packet-mutation', 'none').stderr.startsWith(foreignThrowBanner)).toBe(true);
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
