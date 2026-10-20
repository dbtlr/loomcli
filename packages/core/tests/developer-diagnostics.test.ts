import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { expectRuleParts } from './rule-parts.js';

function diagnostics(scenario: string) {
  const result = invoke(new URL('fixtures/diagnostics.mjs', import.meta.url), [scenario]);
  expect(result.stderr).toBe('');
  return result.stdout;
}

// The text core's reference shows for the fixture plugin's retry(50).
test("a third-party rule's thrown fault carries its whole diagnostic in message", () => {
  expect(diagnostics('retry')).toBe(
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

test('a structured fault keeps its parts on fields of their own', () => {
  expect(JSON.parse(diagnostics('fields'))).toEqual({
    correction: 'Pass a whole number from 0 through 10.',
    exitCode: 1,
    findings: [{ arguments: [50], call: 'retry', mark: '0', note: 'from 0 through 10' }],
    name: 'DeclarationError',
    rule: '@acme/retry/retry-limit',
    same: true,
    sentence: 'retry() received 50 retries.',
  });
});

test('a sentence-only fault renders the generic banner and its sentence alone', () => {
  expect(diagnostics('sentence-only')).toBe(
    [
      '-- INVALID DECLARATION ---------------------------------------------------------',
      '',
      'Plugin "@acme/trace" received a level of 9. Pass a level from 0 through 3.',
      '',
    ].join('\n'),
  );
  expect(JSON.parse(diagnostics('sentence-only-fields'))).toEqual({
    cause: 'why',
    correction: null,
    findings: [],
    rule: null,
    sentence: 'One sentence.',
  });
});

test('a fault between two declarations carries a finding for each, and a correction list prints one fix per line', () => {
  expect(diagnostics('collision')).toBe(
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

test('a diagnostic escapes every control, line separator, and bidirectional control it repeats', () => {
  const text = diagnostics('escaped');
  // The author's own line break in a sentence stays a break; every other control is escaped.
  expect(text).toContain('retry() received "a\\u202eb\nc".');
  expect(text).toContain(String.raw`    retry('a\u202eb\u000ac')`);
  expect(text).not.toContain('\u202e');
});

test('an InternalError takes a rule and keeps its sentence as its message', () => {
  const [structured, plain] = diagnostics('internal').trimEnd().split('\n');
  expect(JSON.parse(structured ?? '')).toEqual({
    cause: true,
    correction: 'Fix the loop.',
    message: 'The retry loop broke.',
    rule: '@acme/retry/retry-limit',
    sentence: 'The retry loop broke.',
  });
  expect(JSON.parse(plain ?? '')).toEqual({ message: 'Plain.', rule: null, sentence: 'Plain.' });
});

test('diagnosticRule() returns a frozen descriptor', () => {
  expect(JSON.parse(diagnostics('frozen'))).toEqual({
    docs: 'https://example.com/rules/option-collision',
    frozen: true,
    headline: 'Option declared twice',
    identity: '@acme/trace/option-collision',
    none: null,
  });
});

test('diagnosticRule() accepts subpath segments between the package and the rule name', () => {
  expect(diagnostics('subpath-identity')).toBe('@acme/retry/backoff/retry-limit\n');
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
])('diagnosticRule() rejects %s', (scenario, rule, sentence, correction) => {
  const text = diagnostics(scenario);
  expect(text).toContain(' @loomcli/core/rule-');
  expectRuleParts(text, { correction, rule, sentence });
});

/** What a development run that meets the fault writes on stderr, on the terminal the test names. */
function runDiagnostic(input: Record<string, unknown>): string {
  const result = invoke(new URL('fixtures/diagnostics.mjs', import.meta.url), [
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

test("the banner fills stderr's width and the explanation wraps at it", () => {
  const stderr = runDiagnostic({ terminal: stderrTerminal({ columns: 100 }) });
  expect(stderr.split('\n')[0]).toBe(
    `-- RETRY LIMIT OUT OF RANGE ${'-'.repeat(48)} @acme/retry/retry-limit`,
  );
  expect(stderr).toContain(`\n\n${explanationAt100.join('\n')}\n\n`);
});

test('COLUMNS narrows the width the diagnostic fills', () => {
  const stderr = runDiagnostic({
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

test('a stderr that is not a terminal falls back to 80 columns, whatever width it reports', () => {
  const stderr = runDiagnostic({ terminal: stderrTerminal({ columns: 100, isTTY: false }) });
  expect(stderr.split('\n')[0]).toBe(
    `-- RETRY LIMIT OUT OF RANGE ${'-'.repeat(28)} @acme/retry/retry-limit`,
  );
  expect(stderr).toContain(
    '\nEach retry repeats the request against the service, so a large limit can hold\nthe terminal',
  );
});

test('a terminal that reports no width falls back to 80 columns', () => {
  const stderr = runDiagnostic({ terminal: stderrTerminal({ columns: undefined }) });
  expect(stderr.split('\n')[0]).toHaveLength(80);
});

test('the explanation wraps by display width, so wide characters fill two columns', () => {
  const stderr = runDiagnostic({ terminal: stderrTerminal({ columns: 25 }), wide: true });
  expect(stderr).toContain('\n界界界界界 界界界界界\n界界界界界\n');
});
