import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';
import { coreRuleParts } from './rule-parts.js';

function run(scenario: string, argv: string[] = [], env: Record<string, string> = {}) {
  return invoke(new URL('fixtures/translators.mjs', import.meta.url), [scenario, ...argv], { env });
}

/** One scenario run as a development build, which prints a defect's Developer Diagnostic. */
function develop(scenario: string) {
  return run(scenario, [], { FIXTURE_BUILD: 'development' });
}

/** What a distributed build prints for every defect: the generic message, once. */
const generic = 'translators: Something went wrong.\n';

/** The banner of the broken-translator rule, 80 columns wide. */
const brokenBanner = `-- BROKEN TRANSLATOR ${'-'.repeat(27)} @loomcli/core/broken-translator`;

/** The fix every broken translator's diagnostic closes with. */
const brokenCorrection =
  'Return a failure, or undefined to pass, and throw nothing from the translator.';

/** A run whose foreign throw one translator answered with the fixture's 69 failure. */
function translated(from: string, calls: readonly string[]) {
  return {
    status: 69,
    stderr: `Unavailable from ${from}.\n`,
    stdout: [...calls, 'resolved:69', ''].join('\n'),
  };
}

test('a foreign throw from an action exits with the translated class code and renders its view', () => {
  expect(run('action')).toEqual(translated('application', ['application:SyntaxError']));
});

test('a throw no translator answers stays an internal error with exit 1', () => {
  expect(run('untranslated')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'resolved:1\n',
  });
});

test('a foreign throw from a middleware before next() reaches the translator', () => {
  expect(run('middleware')).toEqual(translated('application', ['application:SyntaxError']));
});

test('a foreign throw from a configuration source reaches the translator', () => {
  expect(run('source')).toEqual(translated('application', ['application:SyntaxError']));
});

test('a translated source failure is held, so a takeover reports nothing', () => {
  expect(run('source-takeover')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'took over\napplication:SyntaxError\nresolved:0\n',
  });
});

test('a middleware that awaits next() catches the raw throw, not the translated failure', () => {
  expect(run('raw')).toEqual(
    translated('application', ['caught:SyntaxError', 'application:SyntaxError']),
  );
});

test('a throw a middleware caught is never offered, and the middleware decides the outcome', () => {
  expect(run('caught')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'caught:SyntaxError\nresolved:0\n',
  });
});

test.each([
  ['order-shared', 'application', ['application:SyntaxError']],
  ['order-base', 'application', ['application:SyntaxError']],
  ['order-plugins', 'first', ['first:SyntaxError']],
  ['order-derived', 'derived-two', ['derived-one:pass', 'derived-two:SyntaxError']],
  ['order-next', 'plugin', ['application:pass', 'plugin:SyntaxError']],
])('%s resolves to the translator of %s', (scenario, from, calls) => {
  expect(run(scenario)).toEqual(translated(from, calls));
});

test.each([
  ['cancelled', [], 130],
  ['cancelled-name', [], 130],
  ['closing-proxy', [], 1],
  ['fatal', [], 1],
  ['hook', [], 1],
  ['loader', [], 1],
  ['null-prototype', [], 1],
  ['render', [], 1],
  ['answers', [], 1],
  ['string', [], 1],
  ['validator', ['--level', 'high'], 1],
  ['validator-output', ['--doc', '{nope'], 1],
  ['view', [], 1],
])('a throw from %s never reaches a translator', (scenario, argv, status) => {
  const result = run(scenario, argv);
  expect(result.status).toBe(status);
  expect(result.stdout).not.toContain('catch-all');
  expect(result.stderr).not.toContain('The translator');
  expect(result.stdout).toMatch(new RegExp(`resolved:${String(status)}\\n$`, 'u'));
  expect(result.stderr).not.toContain('Unavailable');
});

test("a cancelled run whose throw has an unreadable name keeps its cancellation code and never reports the name getter's error", () => {
  expect(run('cancelled-name')).toEqual({
    status: 130,
    stderr: generic,
    stdout: 'resolved:130\n',
  });
});

test('a middleware throw during unwinding is offered to the translators like any middleware throw', () => {
  expect(run('unwinding')).toEqual(translated('catch-all', ['dispatched', 'catch-all:Error']));
});

test.each([
  ['broken-throws', 'threw: The translator failed.'],
  ['broken-string', 'returned a string instead of a failure.'],
  ['broken-promise', 'returned a promise instead of a failure.'],
])('%s is a defect, and no later translator is called', (scenario, clause) => {
  expect(run(scenario)).toEqual({ status: 1, stderr: generic, stdout: 'resolved:1\n' });
  const developed = develop(scenario);
  expect(developed).toMatchObject({ status: 1, stdout: 'resolved:1\n' });
  expect(coreRuleParts(developed.stderr)).toEqual({
    correction: brokenCorrection,
    rule: 'broken-translator',
    sentence: `The translator the Application registered for "SyntaxError" ${clause}`,
  });
});

test("a throwing translator's diagnostic shows the translator's own source, then its throw, then the original throw", () => {
  const { stderr } = develop('broken-throws');
  expect(stderr).toMatch(/\n> +\d+ \|     throw new Error\('The translator failed\.'\);\n/u);
  const translator = stderr.indexOf('\nHolds Error: The translator failed.\n    at ');
  const original = stderr.indexOf('\nHolds SyntaxError: Unexpected token.\n    at ');
  expect(translator).toBeGreaterThan(stderr.indexOf('\nAggregateError: '));
  expect(original).toBeGreaterThan(translator);
});

test("a translator that returned a non-failure shows the original throw's source and chain", () => {
  const { stderr } = develop('broken-string');
  expect(stderr).toMatch(/\n> +\d+ \|   throw new SyntaxError\('Unexpected token\.'\);\n/u);
  expect(stderr).toContain('\n\nSyntaxError: Unexpected token.\n    at ');
  expect(stderr).not.toContain('Holds ');
});

test('the key name and reason of a broken translator are escaped onto one line', () => {
  expect(run('broken-escaped')).toEqual({ status: 1, stderr: generic, stdout: 'resolved:1\n' });
  expect(develop('broken-escaped').stderr).toContain(
    '\n\nThe translator the Application registered for "Escaped\\u202eError" threw: The translator failed\\u000d\\u000aforged\\u202eline.\n\n',
  );
});

test('a broken translator a plugin registered is named by its identity', () => {
  expect(run('broken-plugin')).toEqual({ status: 1, stderr: generic, stdout: 'resolved:1\n' });
  expect(develop('broken-plugin').stderr).toContain(
    '\n\nThe translator plugin "@fixture/broken" registered for "SyntaxError" threw: The translator failed.\n\n',
  );
});

test("a throwing translator's defect keeps both throws, the translator's first", () => {
  expect(run('defect-cause-throws')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'cause:AggregateError:translator,original\nresolved:1\n',
  });
});

test("a translator that returns a non-failure keeps the original throw as the defect's cause", () => {
  expect(run('defect-cause-returned')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'cause:original\nresolved:1\n',
  });
});

test('a translated failure carries the foreign throw as its cause only when the translator passes it', () => {
  expect(run('cause')).toEqual(translated('cause', ['cause:SyntaxError:Unexpected token.']));
  expect(run('no-cause')).toEqual(
    translated('application', ['application:SyntaxError', 'cause:none']),
  );
});

test('a sequence source the action let propagate reports once, as the translated failure', () => {
  const result = run('sequence');
  expect(result.status).toBe(69);
  expect(result.stdout).toBe('one\napplication:SyntaxError\nresolved:69\n');
  expect(result.stderr).toContain('Unavailable from application.\n');
  expect(result.stderr).not.toContain('Something went wrong');
});

const incompleteLine = 'Output is incomplete: the root Command stopped after 1 rows, 1 written.\n';

test.each(['sequence', 'sequence-unawaited'])(
  '%s: a row source that throws is translated whether the action awaited the call or never did',
  (scenario) => {
    expect(run(scenario)).toEqual({
      status: 69,
      stderr: `${incompleteLine}Unavailable from application.\n`,
      stdout: 'one\napplication:SyntaxError\nresolved:69\n',
    });
  },
);

test('a row source failure the action caught is final, and the incomplete line still marks the result', () => {
  expect(run('sequence-caught')).toEqual({
    status: 0,
    stderr: incompleteLine,
    stdout: 'one\ncaught\nresolved:0\n',
  });
});

test("a deferred row source's broken translator reports its defect, keeping both throws", () => {
  const result = run('sequence-broken');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(`${incompleteLine}${generic}`);
  expect(develop('sequence-broken').stderr).toContain(
    `${incompleteLine}${brokenBanner}\n\nThe translator the Application registered for "SyntaxError" threw: The translator failed.\n\n`,
  );
});

test('a deferred row source that throws undefined is still a fault that returns 1', () => {
  expect(run('sequence-undefined')).toEqual({
    status: 1,
    stderr: `${incompleteLine}${generic}`,
    stdout: 'one\nresolved:1\n',
  });
});

test('a failure a deferred row source throws is never offered and exits with its own code', () => {
  expect(run('sequence-failure')).toEqual({
    status: 69,
    stderr: `${incompleteLine}Unavailable from source.\n`,
    stdout: 'one\nresolved:69\n',
  });
});

test('a destination write failure the action lets propagate is answered by its translator', () => {
  expect(run('destination')).toEqual(translated('application', ['application:PipeError']));
});

test('the failure classes an author constructs accept the platform ErrorOptions', () => {
  expect(JSON.parse(run('error-options').stdout)).toEqual({
    DeclarationError: true,
    DocumentError: true,
    FatalError: true,
    InputError: true,
    uncaused: false,
  });
});
