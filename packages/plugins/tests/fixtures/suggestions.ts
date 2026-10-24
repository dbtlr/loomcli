import {
  Application,
  Command,
  FatalError,
  InputError,
  override,
  plugin,
  UnknownCommandError,
  UsageError,
} from '@loomcli/core';
import type { StandardSchemaV1 } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { suggestions } from '@loomcli/plugins/suggestions';
import { mockProcess } from '@loomcli/testing';

const dispatch = ({ out }: { out: { print(text: string): unknown } }) => out.print('dispatched');

/** A plugin whose only contribution is one hint for every failure, so a test reads hint order. */
function pointer(name: string) {
  return plugin(`fixture/${name.toLowerCase()}`, { onFailure: () => `${name} hint.` });
}

/** A view that names who wrote it, so a test reads which override resolved. */
function owned(owner: string) {
  return { render: (failure: Error) => `${owner}: ${failure.name}\n` };
}

/** A plugin whose only contribution is an override of the unknown-command view. */
function overriding(name: string) {
  return plugin(`fixture/${name}`, { views: [override(UnknownCommandError, owned(name))] });
}

/** A validator that rejects every value, so a declared default fails after graph build. */
const refuses: StandardSchemaV1 = {
  '~standard': {
    validate: () => ({ issues: [{ message: 'No.' }] }),
    vendor: 'fixture',
    version: 1,
  },
};

/** A child a group takes. */
type Child = Parameters<InstanceType<typeof Command>['command']>[0];

/** Groups of callable children, so each matcher case reads its own candidates. */
function group(name: string, [first, ...rest]: readonly [Child, ...Child[]]) {
  let parent = new Command(name).command(first);
  for (const child of rest) {
    parent = parent.command(child);
  }
  return parent;
}

function leaf(name: string, declared: ConstructorParameters<typeof Command>[1] = {}) {
  return new Command(name, declared).action(dispatch);
}

/** Each way an action can end the run with a failure. */
const endings: Record<string, () => never> = {
  fatal: () => {
    throw new FatalError('The store is locked. Close the other session.');
  },
  input: () => {
    throw new InputError('Supply a shorter name.', []);
  },
  internal: () => {
    throw new Error('boom');
  },
  // A failure whose token an action replaced with a value that is not a string.
  mutated: () => {
    const failure = new UnknownCommandError('gte', []);
    Object.defineProperty(failure, 'token', { value: 42 });
    throw failure;
  },
};

/**
 * One application whose groups isolate the matcher cases: the edit kinds, the length budget,
 * ranking, excluded members, and options of every spelling kind on `opts`.
 */
function kit(declared: ConstructorParameters<typeof Application>[1]) {
  return (
    new Application('kit', declared)
      .globalOption('file', { type: 'string' })
      .command(group('edits', [leaf('get'), leaf('lane'), leaf('Build')]))
      .command(group('budget', [leaf('four'), leaf('fives'), leaf('seasoned'), leaf('overnight')]))
      .command(group('rank', [leaf('tap'), leaf('tip'), leaf('top'), leaf('tup')]))
      .command(
        group('excluded', [
          leaf('secret', { hidden: true }),
          leaf('legacy', { deprecated: 'Use keys instead.' }),
          new Command('keys').alias('ls').action(dispatch),
        ]),
      )
      .command(
        new Command('opts')
          .option('field', { type: 'string' })
          .option('color', { polarity: 'both', type: 'boolean' })
          .option('verbosity-level', { polarity: 'both', type: 'boolean' })
          .option('ééé', { type: 'boolean' })
          .option('xy', { type: 'boolean' })
          .option('keep', { short: 'k', type: 'boolean' })
          .option('secret', { hidden: true, type: 'boolean' })
          .option('older', { deprecated: 'Use --keep instead.', type: 'boolean' })
          .action(dispatch),
      )
      // A counted option has one long spelling and no negative one; the group is hidden from listings.
      .command(
        new Command('tally', { hidden: true })
          .option('quietness', { short: 'q', type: 'count' })
          .action(dispatch),
      )
      .command(
        new Command('work')
          .argument('name', { required: true })
          .option('end', { type: 'string' })
          .action((context) => {
            const ending = endings[context.options.end ?? ''];
            return ending === undefined ? dispatch(context) : ending();
          }),
      )
  );
}

const scenarios = {
  'app-command': () =>
    kit({ plugins: [suggestions()], views: [override(UnknownCommandError, owned('app'))] }),
  'app-usage': () => kit({ plugins: [suggestions()], views: [override(UsageError, owned('app'))] }),
  core: () => kit({}),
  'default-rejected': () =>
    new Application('kit', { plugins: [help(), suggestions()] })
      .option('level', { default: 'loud', type: 'string', validate: refuses })
      .action(dispatch),
  early: () => kit({ plugins: [suggestions(), help(), pointer('Later')] }),
  'help-core': () => kit({ plugins: [help()] }),
  helped: () => kit({ plugins: [help(), suggestions(), pointer('Later')] }),
  'hint-core': () => kit({ plugins: [pointer('First'), pointer('Second')] }),
  hinted: () => kit({ plugins: [suggestions(), pointer('First'), pointer('Second')] }),
  plain: () => kit({ plugins: [suggestions()] }),
  'plugin-after': () => kit({ plugins: [suggestions(), overriding('after')] }),
  'plugin-before': () => kit({ plugins: [overriding('before'), suggestions()] }),
};

/** The scenarios a test names. */
type Scenario = keyof typeof scenarios;

/**
 * One argv run of a scenario's application on a mock process that reports a distributed build.
 * The result reads as a process's would: the status the run set, and what it wrote.
 */
async function runScenario(scenario: Scenario, argv: readonly string[]) {
  const mock = mockProcess({ argv, release: { build: 'distributed' } });
  await scenarios[scenario]().run({ process: mock });
  return { status: mock.exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

export { runScenario };
export type { Scenario };
