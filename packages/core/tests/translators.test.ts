/*
 * Acceptance plan for translators (docs/core/failures.md#translators).
 *
 * Translators are proven when public APIs alone produce these results under Node and Bun:
 *
 * - Example. jsonkit's reader holds no `JSON.parse` catch, and its application registers the
 *   translation above. `jsonkit get name -f broken.json` and the same document piped to `jsonkit
 *   get name` exit 65 and write `The document is not valid JSON. Correct its syntax, or supply
 *   another document.`, and an `onFailure` hook in a fixture reads the `SyntaxError` as the
 *   failure's `cause`.
 * - Untranslated. A `TypeError` from an action with no translation for it reports as an
 *   `InternalError` with exit 1.
 * - Order. An application's translation and a plugin's for one class resolve to the application's;
 *   an application's translation keyed on `Error` beats a plugin's keyed on `SyntaxError`; two
 *   plugins resolve in installation order; a translator that returns `undefined` passes to the next
 *   one, within one contributor in list order and then to the next contributor.
 * - Reach. A foreign throw from an action, from a middleware before it calls `next()`, and from a
 *   configuration source's resolver each reaches the translator and exits with the translated
 *   class's code, 69 for a class that declares `EX_UNAVAILABLE`. A row source that yields one row
 *   and then throws a `SyntaxError` under `out.results()` exits 69 whether the action awaited the
 *   call or never awaited it, with the row and the incomplete-result line ahead of the translated
 *   failure's report, and an action that caught its rejection exits 0 with the row and the line and
 *   calls no translator. A middleware that throws an `Error` after its `next()` has settled reaches
 *   the translator and exits 69, and a stdout write that fails with an `ENOSPC`-style error under
 *   an awaited `out.print` exits 69 with no fallback line. A throw from a failure view, an
 *   `onFailure` hook, a validator, a getter on a validator's output, and a plugin loader, a thrown
 *   `FatalError`, a thrown string, and an object with a `null` prototype never reach it. A caller
 *   abort whose action rejects with the signal's reason resolves 130 and calls no translator.
 * - The raw throw. A middleware that awaits `next()` around an action that throws a `SyntaxError`
 *   catches the `SyntaxError`, not the translated failure.
 * - A translator that throws. It reports a defect with exit 1, and a later translator that would
 *   have answered is not called. In a distributed build the text is the generic defect message; in
 *   a development build it is the diagnostic of `@loomcli/core/foreign-throw`, which shows the
 *   translator's line and its throw, the defect's `cause`.
 * - Types. The translator's parameter types as the key's instance type, and a translator returning
 *   a string or an `Error` that is not a `LoomError` is a compile error.
 */

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

/** The banner of the foreign-throw rule, 80 columns wide. */
const foreignBanner = `-- UNHANDLED EXCEPTION ${'-'.repeat(29)} @loomcli/core/foreign-throw`;

/** The fix every foreign throw's diagnostic closes with. */
const foreignCorrection =
  'Catch the error where it is thrown and throw a failure class, such as FatalError, with a sentence the operator can act on.';

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

test.each(['broken-throws', 'broken-plugin'])(
  '%s: a translator that throws is a foreign throw from author code, and no later translator is called',
  (scenario) => {
    expect(run(scenario)).toEqual({ status: 1, stderr: generic, stdout: 'resolved:1\n' });
    const developed = develop(scenario);
    expect(developed).toMatchObject({ status: 1, stdout: 'resolved:1\n' });
    expect(coreRuleParts(developed.stderr)).toEqual({
      correction: foreignCorrection,
      rule: 'foreign-throw',
      sentence: 'The translator failed.',
    });
  },
);

test("a throwing translator's diagnostic shows the translator's own source and its throw alone", () => {
  const { stderr } = develop('broken-throws');
  expect(stderr).toMatch(/\n> +\d+ \|   throw new Error\('The translator failed\.'\);\n/u);
  expect(stderr).toContain('\n\nError: The translator failed.\n    at ');
  expect(stderr).not.toContain('SyntaxError');
});

test("a throwing translator's defect carries the translator's throw as its cause, which no translator is offered", () => {
  expect(run('defect-cause-throws')).toEqual({
    status: 1,
    stderr: generic,
    stdout: 'cause:translator\nresolved:1\n',
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

test("a deferred row source's throwing translator reports the translator's throw as a foreign throw", () => {
  const result = run('sequence-broken');
  expect(result.status).toBe(1);
  expect(result.stderr).toBe(`${incompleteLine}${generic}`);
  expect(develop('sequence-broken').stderr).toContain(
    `${incompleteLine}${foreignBanner}\n\nThe translator failed.\n\n`,
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
  expect(run('destination')).toEqual(translated('application', ['application:DiskError']));
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
