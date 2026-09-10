import { expect, test } from 'vite-plus/test';

import { invoke } from '../../../scripts/test-process.js';

/** The rule every description answers to, whichever declaration carries it. */
const rule =
  'description must hold a character other than whitespace and no line terminator. Supply a one-line summary.';

/** Both build entry points read the core facts, so the fixture is invoked through each. */
function withFact(target: string, fact: string, value: string, mode: 'inspect' | 'run') {
  return invoke(new URL('fixtures/facts.mjs', import.meta.url), [target, fact, value, mode]);
}

/** Each declaration that carries a description, under the subject its diagnostic names. */
const subjects = [
  ['application', 'The Application'],
  ['command', 'Command "get"'],
  ['global-option', 'Global option "file"'],
  ['option', 'Command "get" option "raw"'],
  ['boolean-option', 'Command "get" option "quiet"'],
  ['plugin-option', 'Plugin "@loomcli/log" option "level"'],
  ['argument', 'The root Command argument "files"'],
] satisfies [string, string][];

test.each(subjects)(
  'a blank description on %s is a declaration error in inspect() and in run()',
  (target, subject) => {
    expect(withFact(target, 'description', 'blank', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
    });
    expect(withFact(target, 'description', 'blank', 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${subject} ${rule}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

test.each(subjects)(
  'a whitespace-only description on %s is a declaration error',
  (target, subject) => {
    expect(withFact(target, 'description', 'spaces', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
    });
  },
);

test.each(subjects)('a description that holds a line feed on %s is rejected', (target, subject) => {
  expect(withFact(target, 'description', 'line-feed', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
  });
});

// Whitespace is Unicode White_Space, and the seven line terminators belong to it.
// Each value here holds no character outside that class, or one of those terminators.
test.each([
  'tabs',
  'carriage-return',
  'form-feed',
  'line-separator',
  'next-line',
  'next-line-inside',
  'no-break-space',
  'paragraph-separator',
  'vertical-tab',
])('a %s description is rejected with the same sentence', (value) => {
  expect(withFact('command', 'description', value, 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `assembled\ndeclaration:1: Command "get" ${rule}\n`,
  });
});

/** Every subject reads one rule, so a value that is not a string reports it wherever it lands. */
const nonStrings: [string, string, string][] = subjects.flatMap(([target, subject]) =>
  ['null', 'number', 'string-object'].map((value): [string, string, string] => [
    target,
    value,
    subject,
  ]),
);

test.each(nonStrings)(
  'a %s description that is the %s value is rejected, naming %s',
  (target, value, subject) => {
    expect(withFact(target, 'description', value, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${rule}\n`,
    });
  },
);

/** The rule every declared version answers to, the same sentence `inspect()` and `run()` report. */
const versionRule =
  'The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".';

test.each(['null', 'number', 'string-object'])(
  'a version that is the %s value is a declaration error in inspect() and in run()',
  (value) => {
    expect(withFact('application', 'version', value, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${versionRule}\n`,
    });
    expect(withFact('application', 'version', value, 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${versionRule}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

test.each(['blank', 'spaces', 'line-feed'])(
  'a %s version is a declaration error in inspect() and in run()',
  (value) => {
    expect(withFact('application', 'version', value, 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${versionRule}\n`,
    });
    expect(withFact('application', 'version', value, 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${versionRule}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

// Whitespace is Unicode White_Space, and the seven line terminators belong to it.
// Each value here holds no character outside that class, or one of those terminators.
test.each([
  'tabs',
  'carriage-return',
  'form-feed',
  'line-separator',
  'next-line',
  'next-line-inside',
  'no-break-space',
  'paragraph-separator',
  'vertical-tab',
])('a %s version is rejected with the same sentence', (value) => {
  expect(withFact('application', 'version', value, 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `assembled\ndeclaration:1: ${versionRule}\n`,
  });
});

test.each(subjects.map(([target]) => target))('a one-line summary on %s builds', (target) => {
  expect(withFact(target, 'description', 'summary', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

test('a one-line version builds', () => {
  expect(withFact('application', 'version', 'summary', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

// A no-break space is whitespace, and a zero-width space is a format character.
// Prose holds either one, so a description that holds other characters too is accepted.
test.each(['no-break-space-inside', 'zero-width-space'])('a %s description builds', (value) => {
  expect(withFact('command', 'description', value, 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

/** Each declaration that carries `hidden` and `deprecated`: a named Command and an option. */
const members = [
  ['command', 'Command "get"'],
  ['global-option', 'Global option "file"'],
  ['option', 'Command "get" option "raw"'],
  ['boolean-option', 'Command "get" option "quiet"'],
  ['plugin-option', 'Plugin "@loomcli/log" option "level"'],
] satisfies [string, string][];

/** The rule every deprecation message answers to, whichever member carries it. */
const deprecatedRule =
  'deprecated message must hold a character other than whitespace and no line terminator. Supply a one-line migration path, such as "Use get instead.".';

/** The rule `hidden` answers: a listing asks one question of it, so it holds a Boolean. */
const hiddenRule = 'hidden must be a Boolean. Supply true or false, or omit it.';

test.each(members)(
  'a blank deprecated message on %s is a declaration error in inspect() and in run()',
  (target, subject) => {
    expect(withFact(target, 'deprecated', 'blank', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${deprecatedRule}\n`,
    });
    expect(withFact(target, 'deprecated', 'blank', 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${subject} ${deprecatedRule}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

test.each(members)(
  'a deprecated message that holds a line feed on %s is rejected',
  (target, subject) => {
    expect(withFact(target, 'deprecated', 'line-feed', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${deprecatedRule}\n`,
    });
  },
);

// A deprecation with no migration path is the value the rule exists to reject.
test.each(members)('a deprecated declared as true on %s is rejected', (target, subject) => {
  expect(withFact(target, 'deprecated', 'true', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `assembled\ndeclaration:1: ${subject} ${deprecatedRule}\n`,
  });
});

test.each(members)(
  'a hidden that is not a Boolean on %s is a declaration error in inspect() and in run()',
  (target, subject) => {
    expect(withFact(target, 'hidden', 'summary', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${subject} ${hiddenRule}\n`,
    });
    expect(withFact(target, 'hidden', 'summary', 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${subject} ${hiddenRule}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

test.each(['null', 'number'])('a hidden that is the %s value is rejected', (value) => {
  expect(withFact('command', 'hidden', value, 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: `assembled\ndeclaration:1: Command "get" ${hiddenRule}\n`,
  });
});

test.each(members)('a one-line migration message on %s builds', (target) => {
  expect(withFact(target, 'deprecated', 'migration', 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

test.each(
  members.flatMap(([target]) => [
    [target, 'true'],
    [target, 'false'],
  ]),
)('a hidden declared %s on %s builds', (target, value) => {
  expect(withFact(target, 'hidden', value, 'inspect')).toEqual({
    status: 0,
    stderr: '',
    stdout: 'assembled\ninspected\n',
  });
});

/** The declarations that carry neither fact: the root, which is every page's entry point, and an argument. */
const rejected = [
  ['application', 'hidden', 'The Application'],
  ['application', 'deprecated', 'The Application'],
  ['argument', 'hidden', 'The root Command argument "files"'],
  ['argument', 'deprecated', 'The root Command argument "files"'],
  ['command-argument', 'hidden', 'Command "get" argument "path"'],
  ['command-argument', 'deprecated', 'Command "get" argument "path"'],
] satisfies [string, string, string][];

test.each(rejected)(
  'a %s that declares %s is a declaration error in inspect() and in run()',
  (target, fact, subject) => {
    const reason = `${subject} declares ${fact}, which applies to named Commands and options alone. Remove it.`;
    expect(withFact(target, fact, 'true', 'inspect')).toEqual({
      status: 0,
      stderr: '',
      stdout: `assembled\ndeclaration:1: ${reason}\n`,
    });
    expect(withFact(target, fact, 'true', 'run')).toEqual({
      status: 1,
      stderr: `Invalid declaration: ${reason}\n`,
      stdout: 'assembled\nresolved:1\n',
    });
  },
);

/** The constructor captures each fact, so the fixture changes its options object after it. */
function afterChange(scenario: string) {
  return invoke(new URL('fixtures/capture.mjs', import.meta.url), [scenario]);
}

test.each([
  ['application-description', '"One."'],
  ['application-version', '"1.2.0"'],
  ['command-description', '"One."'],
  ['command-blanked', '"One."'],
])('%s reports the captured value after the options object changes', (scenario, reported) => {
  expect(afterChange(scenario)).toEqual({ status: 0, stderr: '', stdout: `${reported}\n` });
});
