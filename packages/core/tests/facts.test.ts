import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The rule every description answers to, whichever declaration carries it. */
const rule =
  'description must hold a character other than whitespace and no line terminator. Supply a one-line summary.';

/** Both build entry points read the core facts, so the fixture is invoked through each. */
function withFact(target: string, value: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/facts.mjs', import.meta.url), [target, value, mode]);
}

/** Each declaration that carries a description, under the subject its diagnostic names. */
const subjects = [
  ['application', 'The Application'],
  ['command', 'Command "get"'],
  ['global-option', 'Global option "file"'],
  ['option', 'Command "get" option "raw"'],
  ['boolean-option', 'Command "get" option "quiet"'],
  ['argument', 'The root Command argument "files"'],
] satisfies [string, string][];

test.each(subjects)(
  'a blank description on %s is a declaration error in inspect() and in run()',
  (target, subject) => {
    expect(withFact(target, 'blank', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
    });
    expect(withFact(target, 'blank', 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${subject} ${rule}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

test.each(subjects)(
  'a whitespace-only description on %s is a declaration error',
  (target, subject) => {
    expect(withFact(target, 'spaces', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
    });
  },
);

test.each(subjects)('a description that holds a line feed on %s is rejected', (target, subject) => {
  expect(withFact(target, 'line-feed', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
  });
});

test.each(['tabs', 'carriage-return', 'line-separator', 'paragraph-separator', 'number'])(
  'a %s description is rejected with the same sentence',
  (value) => {
    expect(withFact('command', value, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: Command "get" ${rule}\n`,
    });
  },
);

test('a version that is not a string is a declaration error in inspect() and in run()', () => {
  const message = 'The Application version must be a string. Supply a string such as "1.2.0".';
  expect(withFact('version', 'number', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `assembled\ndeclaration:1: ${message}\n`,
  });
  expect(withFact('version', 'number', 'run')).toEqual({
    status: 1,
    stderr: `Invalid declaration: ${message}\n`,
    stdout: 'assembled\nresolved:1\n',
  });
});

test.each([...subjects.map(([target]) => target), 'version'])(
  'a one-line summary on %s builds',
  (target) => {
    expect(withFact(target, 'summary', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: 'assembled\ninspected\n',
    });
  },
);
