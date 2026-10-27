/*
 * Acceptance plan for the post-install declaration (docs/core/application.md#the-post-install-declaration).
 *
 * The declaration is proven when public APIs alone produce these results in the test's process:
 *
 * - On the graph. `inspect()` reports the declared members on `postInstall`, frozen, and
 *   `undefined` when the Application declares neither member.
 * - The words route. A development `inspect()` and `run()`, and `check()`, report
 *   `@loomcli/core/post-install-unrouted` for words that route to no Command and for words that
 *   route to a group, and pass words that route to a Command with an action, a plugin's Command
 *   and words after a global option included. The routed Command's inputs are not parsed.
 * - Builds. A distributed `run()` runs no check. `check()` keeps the fault beside a failing
 *   converter's and goes on to the `onGraphBuilt` hooks.
 *
 * packages/core/tests/check.test.ts proves that `check()` reports the fault from a bundle whose
 * baked facts read distributed, and that a distributed `inspect()` runs no check.
 */
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

import { Application, Command, DeclarationError, diagnosticRule, plugin } from '../src/index.js';
import type { ApplicationOptions } from '../src/index.js';

/** An application with one Command that has an action and one group whose child has one. */
function declared(options: ApplicationOptions = {}) {
  return new Application('mimir', options)
    .globalOption('profile', { type: 'string' })
    .command(
      new Command('setup')
        .option('force', { type: 'boolean' })
        .argument('path', {})
        .action(() => undefined),
    )
    .command(new Command('completion').command(new Command('install').action(() => undefined)));
}

/** The fault a call threw, or `undefined` when it threw none. */
function thrownBy(call: () => unknown): unknown {
  try {
    call();
  } catch (error) {
    return error;
  }
  return undefined;
}

/** The rule identity and sentence of a declaration fault, which each case compares. */
function partsOf(fault: unknown) {
  return fault instanceof DeclarationError
    ? { rule: fault.rule?.identity, sentence: fault.sentence }
    : fault;
}

const unrouted = '@loomcli/core/post-install-unrouted';

test('inspect() reports the declared members on postInstall, frozen', () => {
  const graph = declared({
    postInstall: { command: ['setup'], message: 'Run mimir init in a project.' },
  }).inspect();
  expect(graph.postInstall).toEqual({
    command: ['setup'],
    message: 'Run mimir init in a project.',
  });
  expect(Object.isFrozen(graph.postInstall)).toBe(true);
  expect(Object.isFrozen(graph.postInstall?.command)).toBe(true);
  expect(declared({ postInstall: { message: 'Next.' } }).inspect().postInstall).toEqual({
    message: 'Next.',
  });
});

test('postInstall is undefined when the Application declares neither member', () => {
  expect(declared().inspect().postInstall).toBeUndefined();
  expect(declared({ postInstall: {} }).inspect().postInstall).toBeUndefined();
});

test('the graph keeps its own copy of the words, so a later write to the declared list changes nothing', () => {
  const command: [string, ...string[]] = ['setup'];
  const app = declared({ postInstall: { command } });
  command[0] = 'other';
  expect(app.inspect().postInstall?.command).toEqual(['setup']);
});

/** Words of a post-install command, which the type keeps from being empty. */
type Words = readonly [string, ...string[]];

const unroutedWords: [string, Words, string][] = [
  [
    'an unknown Command',
    ['sync'],
    'The post-install command "sync" routes to no Command with an action.',
  ],
  [
    'a group',
    ['completion'],
    'The post-install command "completion" routes to no Command with an action.',
  ],
  [
    'an unknown child of a group',
    ['completion', 'remove'],
    'The post-install command "completion remove" routes to no Command with an action.',
  ],
];

test.each(unroutedWords)(
  'words that route to %s are a declaration fault from inspect() and check()',
  (_case, words, sentence) => {
    const app = declared({ postInstall: { command: words } });
    expect(partsOf(thrownBy(() => app.inspect()))).toEqual({ rule: unrouted, sentence });
    expect(app.check().map(partsOf)).toEqual([{ rule: unrouted, sentence }]);
  },
);

test('the fault rebuilds the Application call, marks command, and says what to do', () => {
  const app = declared({ postInstall: { command: ['sync'] } });
  const [fault] = app.check();
  expect(fault?.correction).toBe(
    'Name a Command that has an action in postInstall.command, or remove the command.',
  );
  expect(fault?.findings).toEqual([
    {
      arguments: ['mimir', { postInstall: { command: ['sync'] } }],
      call: 'new Application',
      mark: '1.postInstall.command',
    },
  ]);
});

const routedWords: [string, Words][] = [
  ['a Command with an action', ['setup']],
  ['a child with an action under a group', ['completion', 'install']],
  ['a Command after a global option', ['--profile', 'work', 'setup']],
  ['a Command whose own inputs its parser would reject', ['setup', '--unknown', 'a', 'b', 'c']],
];

test.each(routedWords)('words that route to %s pass every check', (_case, words) => {
  const app = declared({ postInstall: { command: words } });
  expect(thrownBy(() => app.inspect())).toBeUndefined();
  expect(app.check()).toEqual([]);
});

test("words that route to a plugin's Command pass, because the check runs after the hooks", () => {
  const doctor = plugin('@fixture/doctor', {
    commands: [new Command('doctor').action(() => undefined)],
  });
  const app = new Application('mimir', {
    plugins: [doctor],
    postInstall: { command: ['doctor'] },
  }).action(() => undefined);
  expect(app.check()).toEqual([]);
});

test('a development run() reports the fault and exits 1, and a distributed run() runs no check', async () => {
  const app = declared({ postInstall: { command: ['sync'] } });
  const development = mockProcess({ argv: ['setup'], release: { build: 'development' } });
  await expect(app.run({ process: development })).resolves.toBe(1);
  expect(development.stderr.text).toMatch(
    /^-- POST-INSTALL COMMAND UNROUTED -+ @loomcli\/core\/post-install-unrouted\n/u,
  );
  const distributed = mockProcess({ argv: ['setup'], release: { build: 'distributed' } });
  await expect(app.run({ process: distributed })).resolves.toBe(0);
  expect(distributed.stderr.text).toBe('');
});

test("check() keeps the fault beside a failing converter's and goes on to the onGraphBuilt hooks", () => {
  const rule = diagnosticRule('@fixture/judge/rejected', {
    explanation: 'The judge rejects every graph.',
    headline: 'Rejected',
  });
  const judge = plugin('@fixture/judge', {
    onGraphBuilt: () => {
      throw new DeclarationError(rule, { sentence: 'The graph is rejected.' });
    },
  });
  const unconvertible = {
    '~standard': {
      jsonSchema: {
        input: () => {
          throw new Error('No schema.');
        },
        output: () => ({}),
      },
      validate: (value: unknown) => ({ value }),
      vendor: 'probe',
      version: 1 as const,
    },
  };
  const app = new Application('mimir', {
    plugins: [judge],
    postInstall: { command: ['sync'] },
  })
    .globalOption('level', { type: 'string', validate: unconvertible })
    .command(new Command('setup').action(() => undefined));
  expect(app.check().map((fault) => fault.rule?.identity)).toEqual([
    '@loomcli/core/schema-converter-failed',
    unrouted,
    '@fixture/judge/rejected',
  ]);
});
