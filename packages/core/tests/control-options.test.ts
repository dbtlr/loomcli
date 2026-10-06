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

/** Each option declaration under the subject its diagnostic names. */
const options = [
  ['global-option', 'Global option "file"'],
  ['option', 'Command "get" option "raw"'],
  ['boolean-option', 'Command "get" option "quiet"'],
  ['count-option', 'Command "get" option "verbose"'],
  ['plugin-option', 'Plugin "@loomcli/log" option "level"'],
] satisfies [string, string][];

test.each(options)(
  'a control that is not a Boolean on %s is thrown by the call that declares it',
  (target, subject) => {
    expect(withFact(target, 'control', 'summary')).toEqual({
      status: 0,
      stderr: '',
      stdout: `thrown:1: ${subject} declares control that is not a Boolean. Use true or false.\n`,
    });
  },
);

test('a control that is not a Boolean on a hook-declared option is thrown by the hook call at build', () => {
  expect(withFact('hook-option', 'control', 'summary')).toEqual({
    status: 0,
    stderr: '',
    stdout:
      'assembled\ndeclaration:1: Command "get" option "trace" declares control that is not a Boolean. Use true or false.\n',
  });
});

test.each(
  [...options.map(([target]) => target), 'hook-option'].flatMap((target) => [
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

test.each([
  ['argument', 'The root Command argument "files"'],
  ['command-argument', 'Command "get" argument "path"'],
])(
  'an argument that declares control on %s is thrown by the call that declares it',
  (target, subject) => {
    expect(withFact(target, 'control', 'true')).toEqual({
      status: 0,
      stderr: '',
      stdout: `thrown:1: ${subject} declares control, which applies to options alone. Remove it.\n`,
    });
  },
);
