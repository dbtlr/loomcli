import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
/*
 * Acceptance plan for Developer Diagnostics
 * (docs/core/declaration-faults.md#developer-diagnostics).
 *
 * Developer Diagnostics are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Thrown at a call. A fixture whose two `option()` calls give one short spelling throws while it
 *   loads; the error's `message` holds the diagnostic of its rule, and the process's stderr under
 *   both runtimes contains it.
 * - From `run()`. A build fault, a default its validator rejects, and an implied value its
 *   validator rejects each write their pinned diagnostic from source in a development build, with
 *   the application name before the path in the findings.
 * - A third-party rule. The fixture plugin writes the pinned text for `retry(50)`, with two
 *   findings for a fixture fault that names both sides of a collision, and a correction list
 *   printed one line per fix. A sentence-only `DeclarationError` from a fixture plugin writes the
 *   banner and the sentence alone.
 * - The descriptor. `diagnosticRule()` throws for an identity with no package part and one with an
 *   uppercase rule name, and returns a frozen value otherwise.
 * - A defect's source. In a development build, an action that throws a `TypeError` prints the
 *   rule's banner, the action's own source lines with the caret under the failing column, and the
 *   cause's name, escaped message, and stack; a cause chain of two prints both. A frame inside
 *   `node_modules` is skipped for the next qualifying one.
 * - The guards. A fixture throws an Error whose forged stack names a file outside `host.cwd` and
 *   one that names a file that does not exist; `readSource` is not called for the first, the second
 *   answers `undefined`, and both print the frame's location alone. The captured reader answers
 *   `undefined` for a symbolic link under `cwd` that points outside it, with `cwd` itself reached
 *   through a symbolic link, as `/tmp` is on macOS. A frame named by a `file:` URL reads its file.
 *   A `readSource` that throws prints the location alone. In a distributed build `readSource` is
 *   never called. The captured reader answers `undefined` for a FIFO and for a file larger than 1
 *   MiB. A message line that reads as a frame never names a file the reader is asked for, a frame
 *   whose path holds spaces or parentheses reads its file, and an action thrown from a module under
 *   a `host.cwd` reached through a symbolic link prints its source.
 * - Escaping. A cause whose message holds a line break, a bidirectional control, or a U+2028 prints
 *   it escaped by `escapeControlCharacters`, both in the cause chain and where the sentence quotes
 *   it, a validator's thrown reason included.
 * - The layout. Goldens pin the whole text of a third-party rule's fault with findings, a core
 *   declaration fault with a finding for each of two declarations, a core fault with no finding
 *   from `run()`, and a defect with its source and stack.
 * - The families. Every declaration rule in core, the pack, and the catalog pins its identity,
 *   sentence, and correction, family by family. Each explanation lives in its rule's registry, and
 *   one registry test per package checks that every rule there has one declaration, a one-line
 *   headline, and an explanation of whole sentences on one line.
 */
import { coreRuleParts } from './rule-parts.js';
import { invoke as invokeFixture } from './run-fixture.ts';

async function diagnostics(scenario: string) {
  const result = await invokeFixture(new URL('fixtures/diagnostics.mjs', import.meta.url), [
    scenario,
  ]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

// The text core's reference shows for the fixture plugin's retry(50).
test("a third-party rule's thrown fault carries its whole diagnostic in message", async () => {
  await expect(diagnostics('retry')).resolves.toBe(
    [
      '-- RETRY LIMIT OUT OF RANGE ---------------------------- @acme/retry/retry-limit',
      '',
      'retry() received 50 retries.',
      '',
      '    retry(50)',
      '          ^^ from 0 through 10',
      '',
      'Each retry repeats the request against the service, so a large limit can hold',
      'the terminal for minutes. The plugin accepts from 0 through 10 retries.',
      '',
      'Pass a whole number from 0 through 10.',
      '',
    ].join('\n'),
  );
});

test('a structured fault keeps its parts on fields of their own', async () => {
  expect(JSON.parse(await diagnostics('fields'))).toEqual({
    correction: 'Pass a whole number from 0 through 10.',
    exitCode: 1,
    findings: [{ arguments: [50], call: 'retry', mark: '0', note: 'from 0 through 10' }],
    name: 'DeclarationError',
    rule: '@acme/retry/retry-limit',
    same: true,
    sentence: 'retry() received 50 retries.',
  });
});

test('a sentence-only fault renders the generic banner and its sentence alone', async () => {
  await expect(diagnostics('sentence-only')).resolves.toBe(
    [
      '-- INVALID DECLARATION ---------------------------------------------------------',
      '',
      'Plugin "@acme/trace" received a level of 9. Pass a level from 0 through 3.',
      '',
    ].join('\n'),
  );
  expect(JSON.parse(await diagnostics('sentence-only-fields'))).toEqual({
    cause: 'why',
    correction: null,
    findings: [],
    rule: null,
    sentence: 'One sentence.',
  });
});

test('a fault between two declarations carries a finding for each, and a correction list prints one fix per line', async () => {
  await expect(diagnostics('collision')).resolves.toBe(
    [
      '-- OPTION DECLARED TWICE -------------------------- @acme/trace/option-collision',
      '',
      'Option "verbose" is declared by plugin "@acme/trace" and as a local option on Command "get".',
      '',
      "    trace({ options: { verbose: { type: 'boolean' } } })",
      "                       ^^^^^^^^^^^^^^^^^^^^^^^^^^^^ the plugin's global option",
      '',
      '    // get',
      "    new Command('get')",
      "      .option('verbose', { type: 'string', validate: … })",
      '              ^^^^^^^^^ the local option',
      '',
      'One key names one option, so two declarations of it leave a run unable to tell',
      'them apart.',
      '',
      '- Rename the local option.',
      '- Install the plugin without its verbose option.',
      '',
      'See https://example.com/rules/option-collision',
      '',
    ].join('\n'),
  );
});

/*
 * The layout goldens of core's own rules. Every other test of a core rule pins only its identity,
 * sentence, and correction, and the registry test checks each explanation.
 */

test("a core declaration fault between two calls prints a finding for each, then the rule's explanation and correction", async () => {
  const result = await invokeFixture(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [
    'argument-twice',
  ]);
  expect(result).toEqual({
    status: 0,
    stderr: '',
    stdout: [
      '-- ARGUMENT DECLARED TWICE --------------- @loomcli/core/argument-declared-twice',
      '',
      'Argument "path" is declared more than once on Command "get".',
      '',
      '    // get',
      "    new Command('get')",
      "      .argument('path', { required: true })",
      '                ^^^^^^ the first declaration',
      '',
      '    // get',
      "    new Command('get')",
      "      .argument('path', {})",
      '                ^^^^^^ the second declaration',
      '',
      'An action reads each argument under its name, so two arguments with one name',
      'leave one of them unreadable.',
      '',
      'Remove or rename the duplicate.',
      '',
    ].join('\n'),
  });
});

test('a core declaration fault no call declared reports from run() with no finding', async () => {
  const result = await invokeFixture(new URL('fixtures/command-diagnostics.mjs', import.meta.url), [
    'root-without-action',
  ]);
  expect(result).toEqual({
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
    stdout: '',
  });
});

test("a defect prints its sentence, the thrown value's source and stack, then the rule's explanation and correction", async () => {
  const result = invoke(new URL('fixtures/translators.mjs', import.meta.url), ['broken-throws'], {
    env: { FIXTURE_BUILD: 'development' },
  });
  expect(result.status).toBe(1);
  // Each stack frame names a path on the machine that ran the test, so the golden elides frames.
  const framed = result.stderr.replaceAll(/(?:^ {4}at .+\n)+/gmu, '    at …\n');
  // Node reports the throw's column at `new` and Bun at the class name, so the golden reads the
  // Column the runtime reported and pins the caret beneath it.
  const column = Number(/translators\.mjs:147:(?<column>\d+)$/mu.exec(framed)?.groups?.column);
  expect(column).toBeGreaterThan(0);
  const stderr = framed
    .replace(`translators.mjs:147:${column}`, 'translators.mjs:147:9')
    .replace(`      | ${' '.repeat(column - 1)}^\n`, `      | ${' '.repeat(8)}^\n`);
  expect(stderr).toBe(
    [
      '-- UNHANDLED EXCEPTION ----------------------------- @loomcli/core/foreign-throw',
      '',
      'The translator failed.',
      '',
      'packages/core/tests/fixtures/translators.mjs:147:9',
      '',
      "  145 | /** A translator that throws, which is a foreign throw from the author's code. */",
      '  146 | const throwingTranslator = () => {',
      "> 147 |   throw new Error('The translator failed.');",
      '      |         ^',
      '  148 | };',
      '  149 |',
      '',
      'Error: The translator failed.',
      '    at …',
      '',
      'Core reports a value that an action, a middleware, a configuration source, a',
      "view, a translator, or a plugin's hook threw, and that no translator answered,",
      'as a defect, because only the author knows what it means. A distributed build',
      'shows the operator one generic message in its place.',
      '',
      'Catch the error where it is thrown and throw a failure class, such as FatalError, with a sentence the operator can act on.',
      '',
    ].join('\n'),
  );
});

test('a diagnostic escapes every control, line separator, and bidirectional control it repeats', async () => {
  const text = await diagnostics('escaped');
  // The author's own line break in a sentence stays a break; every other control is escaped.
  expect(text).toContain('retry() received "a\\u202eb\nc".');
  expect(text).toContain(String.raw`    retry('a\u202eb\u000ac')`);
  expect(text).not.toContain('\u202e');
});

test('an InternalError takes a rule and keeps its sentence as its message', async () => {
  const [structured, plain] = await diagnostics('internal').then((fixtureResult) =>
    fixtureResult.trimEnd().split('\n'),
  );
  expect(JSON.parse(structured ?? '')).toEqual({
    cause: true,
    correction: 'Fix the loop.',
    message: 'The retry loop broke.',
    rule: '@acme/retry/retry-limit',
    sentence: 'The retry loop broke.',
  });
  expect(JSON.parse(plain ?? '')).toEqual({ message: 'Plain.', rule: null, sentence: 'Plain.' });
});

test('diagnosticRule() returns a frozen descriptor', async () => {
  expect(JSON.parse(await diagnostics('frozen'))).toEqual({
    docs: 'https://example.com/rules/option-collision',
    frozen: true,
    headline: 'Option declared twice',
    identity: '@acme/trace/option-collision',
    none: null,
  });
});

test('diagnosticRule() accepts subpath segments between the package and the rule name', async () => {
  await expect(diagnostics('subpath-identity')).resolves.toBe('@acme/retry/backoff/retry-limit\n');
});

const identityFix =
  'Name it <package>[/<subpath>...]/<kebab-case-rule>, such as "@acme/retry/retry-limit".';

test.each([
  [
    'bad-identity',
    'rule-identity',
    'Diagnostic rule "Retry Limit" has no package part, or a subpath or rule name that is not kebab-case.',
    identityFix,
  ],
  [
    'uppercase-rule',
    'rule-identity',
    'Diagnostic rule "@acme/retry/Retry-Limit" has no package part, or a subpath or rule name that is not kebab-case.',
    identityFix,
  ],
  [
    'no-package',
    'rule-identity',
    'Diagnostic rule "retry-limit" has no package part, or a subpath or rule name that is not kebab-case.',
    identityFix,
  ],
  [
    'empty-segment',
    'rule-identity',
    'Diagnostic rule "@acme/retry//retry-limit" has no package part, or a subpath or rule name that is not kebab-case.',
    identityFix,
  ],
  [
    'uppercase-segment',
    'rule-identity',
    'Diagnostic rule "@acme/retry/Backoff/retry-limit" has no package part, or a subpath or rule name that is not kebab-case.',
    identityFix,
  ],
  [
    'trailing-slash',
    'rule-identity',
    'Diagnostic rule "@acme/retry/backoff/" has no package part, or a subpath or rule name that is not kebab-case.',
    identityFix,
  ],
])('diagnosticRule() rejects %s', async (scenario, rule, sentence, correction) => {
  const text = await diagnostics(scenario);
  expect(text).toContain(' @loomcli/core/rule-');
  expect(coreRuleParts(text)).toEqual({ correction, rule, sentence });
});

/** What a development run that meets the fault writes on stderr, on the terminal the test names. */
async function runDiagnostic(input: Record<string, unknown>): Promise<string> {
  const result = await invokeFixture(new URL('fixtures/diagnostics.mjs', import.meta.url), [
    'run-width',
    JSON.stringify(input),
  ]);
  expect(result.status).toBe(1);
  return result.stderr;
}

const stderrTerminal = (stderr: object) => ({
  stderr: { isTTY: true, rows: 24, ...stderr },
  stdin: { isTTY: false },
  stdout: { columns: undefined, isTTY: false, rows: undefined },
});

const explanationAt100 = [
  'Each retry repeats the request against the service, so a large limit can hold the terminal for',
  'minutes. The plugin accepts from 0 through 10 retries.',
];

test("the banner fills stderr's width and the explanation wraps at it", async () => {
  const stderr = await runDiagnostic({ terminal: stderrTerminal({ columns: 100 }) });
  expect(stderr.split('\n')[0]).toBe(
    `-- RETRY LIMIT OUT OF RANGE ${'-'.repeat(48)} @acme/retry/retry-limit`,
  );
  expect(stderr).toContain(`\n\n${explanationAt100.join('\n')}\n\n`);
});

test('COLUMNS narrows the width the diagnostic fills', async () => {
  const stderr = await runDiagnostic({
    env: { COLUMNS: '60' },
    terminal: stderrTerminal({ columns: 100 }),
  });
  expect(stderr.split('\n')[0]).toBe(
    `-- RETRY LIMIT OUT OF RANGE ${'-'.repeat(8)} @acme/retry/retry-limit`,
  );
  expect(stderr).toContain(
    [
      '',
      'Each retry repeats the request against the service, so a',
      'large limit can hold the terminal for minutes. The plugin',
      'accepts from 0 through 10 retries.',
      '',
    ].join('\n'),
  );
});

test('a stderr that is not a terminal falls back to 80 columns, whatever width it reports', async () => {
  const stderr = await runDiagnostic({ terminal: stderrTerminal({ columns: 100, isTTY: false }) });
  expect(stderr.split('\n')[0]).toBe(
    `-- RETRY LIMIT OUT OF RANGE ${'-'.repeat(28)} @acme/retry/retry-limit`,
  );
  expect(stderr).toContain(
    '\nEach retry repeats the request against the service, so a large limit can hold\nthe terminal',
  );
});

test('a terminal that reports no width falls back to 80 columns', async () => {
  const stderr = await runDiagnostic({ terminal: stderrTerminal({ columns: undefined }) });
  expect(stderr.split('\n')[0]).toHaveLength(80);
});

test('the explanation wraps by display width, so wide characters fill two columns', async () => {
  const stderr = await runDiagnostic({ terminal: stderrTerminal({ columns: 25 }), wide: true });
  expect(stderr).toContain('\n界界界界界 界界界界界\n界界界界界\n');
});
