/*
 * Acceptance plan for control options (docs/core/commands.md#control-options).
 *
 * Control options are proven when public APIs alone produce these results under Node and Bun:
 *
 * - The first-party marks. `inspect()` on jsonkit reports `control: true` on `--help`, `--version`,
 *   `--manifest`, `--explain`, `--color`, `--verbose`, `--quiet`, and the `--format` the
 *   formatter's hook declares on `paths`, and `control: false` on `--file` and `select`'s
 *   `--field`, and `inspect()` on textstat reports `control: true` on `--config`. Every help page
 *   the examples pin is unchanged byte for byte.
 * - Every declarer. A fixture marks a local option, a global option, a plugin's option, and an
 *   option a lifecycle hook declares, and each node reads `true`; an omitted `control` reads
 *   `false`.
 * - No effect at run time. A fixture Command whose option is marked parses, validates, activates
 *   its plugin's middleware, and reaches the action exactly as the same option unmarked does.
 * - Faults. The negative type checks reject `control` on an argument and `control: 'yes'` on an
 *   option.
 */

import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

const fixture = new URL('fixtures/control-options.mjs', import.meta.url);

/** The fixture's output for one scenario, which ran without a fault of its own. */
function report(scenario: string): string {
  const result = invoke(fixture, [scenario]);
  expect(result.stderr).toBe('');
  expect(result.status).toBe(0);
  return result.stdout;
}

/**
 * The call that declares a fact checks it, so a faulty fact throws before any build and a valid one
 * reaches `inspect()`.
 */
function withFact(target: string, fact: string, value: string) {
  return invoke(new URL('fixtures/facts.mjs', import.meta.url), [target, fact, value, 'inspect']);
}

test('every declarer marks its option, and an omitted mark reads false', () => {
  expect(JSON.parse(report('marks'))).toEqual({
    marked: { depth: true, field: false, level: true, raw: true, trace: true },
    omitted: { depth: false, field: false, level: false, raw: false, trace: false },
  });
});

test('a marked option parses, validates, activates its middleware, and reaches the action as an unmarked one', () => {
  const { marked, unmarked }: Record<string, unknown> = JSON.parse(report('runtime'));
  expect(marked).toEqual(unmarked);
  expect(marked).toEqual({
    exitCode: 0,
    rejected: 2,
    // Validation faults are held until dispatch, so the middleware runs for the rejected call too.
    seen: [
      'middleware:3',
      'action:{"level":"high","depth":3,"raw":true,"field":"name","trace":true}',
      'middleware:undefined',
    ],
    stderr: 'probe: Option "--depth": Use a number.\n',
  });
});

/** Each option declaration that carries a control mark. */
const options = ['global-option', 'option', 'boolean-option', 'count-option', 'plugin-option'];

test.each(
  [...options, 'hook-option'].flatMap((target) => [
    [target, 'true'],
    [target, 'false'],
  ]),
)('a control declared on %s as %s builds', (target, value) => {
  expect(withFact(target, 'control', value)).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});
