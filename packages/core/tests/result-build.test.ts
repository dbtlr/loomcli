import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** A result rule throws from its call or attach, or, on the root, from both build entry points. */
function withResult(scenario: string, place: 'command' | 'root', mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/result-build.mjs', import.meta.url), [scenario, place, mode]);
}

/** Each rejected declaration and the sentence it reports after its subject. */
const rules = [
  [
    'after-action',
    'declares its result after its action. Declare result() or rows() before action().',
  ],
  ['two-results', 'declares two results. Declare one result() or rows() call.'],
  ['no-action', 'declares a result and no action. Register an action or remove the result.'],
  [
    'views-no-result',
    'reshapes its views and declares no result. Declare result() or rows() before action().',
  ],
  [
    'row-view-on-value',
    'names row view "records" on a value result. Supply a view with render, or declare the result with rows().',
  ],
  [
    'not-a-view',
    'names view "table" with a value that is not a view. Supply a view with render or a row view with row.',
  ],
  ['both-shapes', 'names view "both" with render and row. Supply one of the two.'],
  [
    'bad-name',
    'names view "wide table". Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.',
  ],
  [
    'integer-name',
    'names view "0". Use a nonempty name without whitespace, a leading hyphen, or "=", and not a number.',
  ],
  ['empty-record', 'declares a result with no views. Name at least one view.'],
  [
    'missing-default',
    'selects default view "wide", which it does not name. Name the view or select a named one.',
  ],
] satisfies [string, string][];

/** The subject each place reports, which is how every core diagnostic names a Command. */
const places = [
  ['root', 'The root Command'],
  ['command', 'Command "count"'],
] satisfies ['command' | 'root', string][];

/**
 * The rules a finished Command answers, which `views()` can still change until the Command is
 * final. A named Command is final when it attaches; the root is final only at build.
 */
const finished = new Set(['empty-record', 'missing-default', 'no-action']);

/** Every rule at every depth, each under the moment that first holds the data proving it. */
const cases = places.flatMap(([place, subject]) =>
  rules.map(([scenario, rule]) => ({ place, rule, scenario, subject })),
);

test.each(cases.filter((entry) => entry.place === 'command' || !finished.has(entry.scenario)))(
  'a $scenario result on $subject throws from the call or the attach that proves it',
  (entry) => {
    const { place, rule, scenario, subject } = entry;
    expect(withResult(scenario, place, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `thrown:1: ${subject} ${rule}\n`,
    });
  },
);

test.each(cases.filter((entry) => entry.place === 'root' && finished.has(entry.scenario)))(
  'a $scenario result on $subject is a declaration error at build',
  (entry) => {
    const { place, rule, scenario, subject } = entry;
    expect(withResult(scenario, place, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
    });
    expect(withResult(scenario, place, 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${subject} ${rule}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);
