import {
  Application,
  Command,
  FatalError,
  InputError,
  LoomError,
  override,
  plugin,
  UnknownCommandError,
  UnknownOptionError,
  UsageError,
} from '@loomcli/core';

import { declare } from './declare.mjs';

const [scenario, ...argv] = process.argv.slice(2);

/** Every hook call, in call order, printed to stdout ahead of the resolved code. */
const calls = [];

/** The caller's own controller, which a cancelling scenario aborts from its action. */
const controller = new AbortController();

/** A plugin whose only contribution is one `onFailure` hook, which records each call. */
function hinting(identity, answer) {
  return plugin(identity, {
    onFailure: (failure, context) => {
      calls.push(`hook:${identity}:${failure.name}:[${context.path.join(',')}]`);
      return answer(failure, context);
    },
  });
}

/** What a failure view reads of where the run was, so a test reads the context it received. */
const where = {
  render: (failure, { application, hints, path }) =>
    `${JSON.stringify({ application, hints, name: failure.name, path })}\n`,
};

/** An override that prints the hints in its own form, beside its own sentence. */
const bracketed = {
  render: (failure, { hints }) =>
    [`usage: ${failure.message}`, ...hints.map((hint) => `  (${hint})`)]
      .map((line) => `${line}\n`)
      .join(''),
};

const breaks = {
  render: () => {
    throw new Error('Cannot render the failure.');
  },
};

const dispatch = ({ out }) => out.print('dispatched');

/** An error whose message cannot be read as a string, in each way a JavaScript author can write. */
const unreadable = {
  getter: () =>
    Object.defineProperty(new Error('x'), 'message', {
      get() {
        throw new Error('The getter failed.');
      },
    }),
  object: () =>
    Object.defineProperty(new Error('x'), 'message', {
      value: {
        toString() {
          throw new Error('The conversion failed.');
        },
      },
    }),
  proxy: () =>
    new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error('The trap failed.');
        },
      },
    ),
  symbol: () => Object.defineProperty(new Error('x'), 'message', { value: Symbol('message') }),
};

/**
 * A two-level graph: a group with a visible child, a hidden child, and an aliased child, and
 * options of each listing kind on the root and on the child, so a hook's candidates are visible.
 */
function routed(options = {}) {
  const clear = new Command('clear')
    .option('keep', { short: 'k', type: 'boolean' })
    .option('secret', { hidden: true, type: 'boolean' })
    .option('old', { deprecated: 'Use --keep instead.', type: 'boolean' })
    .action(dispatch);
  const cache = new Command('cache')
    .command(clear)
    .command(new Command('purge', { hidden: true }).action(dispatch))
    .command(new Command('list').alias('ls').action(dispatch));
  return new Application('store', options)
    .globalOption('file', { short: 'f', type: 'string' })
    .globalOption('trace', { hidden: true, type: 'boolean' })
    .globalOption('legacy', { deprecated: 'Use --file instead.', type: 'boolean' })
    .command(cache);
}

/** A broken hook installed ahead of a working one, on a graph whose fault is a usage error. */
function broken(answer) {
  return routed({
    plugins: [hinting('fixture/broken', answer), hinting('fixture/fine', () => 'still here')],
  }).action(dispatch);
}

/** A validator that rejects the value `bad` alone, with a field core does not read. */
const coded = {
  '~standard': {
    validate: (value) =>
      value === 'bad' ? { issues: [{ code: 'too_short', message: 'Too short.' }] } : { value },
    vendor: 'fixture',
    version: 1,
  },
};

/** Every issue the reported problems carry, whole, so a test reads the fields a view receives. */
const issues = {
  render: (failure) =>
    `${JSON.stringify(failure.problems.flatMap((problem) => problem.issues ?? []))}\n`,
};

/** A hook that reads its candidates from the graph, leaving out what completion leaves out. */
function suggest(failure, { command, graph }) {
  if (failure instanceof UnknownOptionError) {
    const offered = [...graph.globals, ...command.options].filter(
      (option) => !option.hidden && option.deprecated === undefined,
    );
    const spellings = offered.flatMap((option) =>
      [option.long, option.short].filter((spelling) => spelling !== null),
    );
    return `options: ${spellings.join(' ')}`;
  }
  if (failure instanceof UnknownCommandError) {
    const children = command.children.filter(
      (child) => !child.hidden && child.deprecated === undefined,
    );
    return `children: ${children.map((child) => child.name).join(' ')}`;
  }
  return undefined;
}

/** A middleware that runs the rest of the chain, then misuses `next()` with a second call. */
const twice = plugin('fixture/twice', {
  middleware: {
    activate: 'always',
    load: async () => ({
      default: async ({ next }) => {
        await next().catch(() => undefined);
        await next().catch(() => undefined);
      },
    }),
  },
});

/** A validator that rejects every value, so a declared default fails before any token is read. */
const refuses = {
  '~standard': {
    validate: () => ({ issues: [{ message: 'No.' }] }),
    vendor: 'fixture',
    version: 1,
  },
};

/** An array whose own `filter` answers a list other than the one it holds. */
class Lying extends Array {
  filter() {
    return [{ toString: () => 'from filter' }];
  }
}

/** An array whose proxy answers a `filter` of its own, which core must never call. */
function proxied(held) {
  return new Proxy(held, {
    get: (target, key, receiver) =>
      key === 'filter' ? () => ['from filter'] : Reflect.get(target, key, receiver),
  });
}

/** A reason holding a line break, then ESC, CR, and the line and paragraph separators. */
const multiline = 'line one\nline two';
const controls = [27, 13, 8232, 8233].map((code) => String.fromCodePoint(code)).join('');

/** One scenario per unreadable error, each thrown by a broken hook beside a working one. */
const unreadableScenarios = Object.fromEntries(
  Object.entries(unreadable).map(([kind, raise]) => [
    `broken-unreadable-${kind}`,
    () =>
      broken(() => {
        throw raise();
      }),
  ]),
);

const scenarios = {
  ...unreadableScenarios,
  // The action fails, then a plugin's misused next() is reported after it.
  'after-primary': () =>
    new Application('store', {
      plugins: [twice, hinting('fixture/one', (failure) => `hint for ${failure.name}`)],
    }).action(({ out }) => out.fatal('The action failed.')),
  // A JavaScript hook steps outside the contract and assigns the code, which core already read.
  'assigns-exit-code': () =>
    routed({
      plugins: [
        hinting('fixture/one', (failure) => {
          failure.exitCode = 0;
          return 'hinted';
        }),
      ],
    }).action(dispatch),
  'broken-array': () => broken(() => ['fine', 7]),
  // Index 1 of three is never assigned, so the list holds a hole there.
  'broken-controls': () =>
    broken(() => {
      throw new Error(`red${controls}end`);
    }),
  'broken-hole': () => broken(() => Object.assign([], { 0: 'a', 2: 'c' })),
  'broken-lying-filter': () => broken(() => Lying.of(7)),
  'broken-multiline': () =>
    broken(() => {
      throw new Error(multiline);
    }),
  'broken-number': () => broken(() => 7),
  'broken-promise': () => broken(async () => 'late'),
  'broken-proxied': () => broken(() => proxied([7])),
  'broken-rejecting': () => broken(() => Promise.reject(new Error('Rejected late.'))),
  'broken-throws': () =>
    broken(() => {
      throw new Error('Cannot suggest.');
    }),
  'broken-view': () =>
    routed({
      plugins: [
        hinting('fixture/broken', () => {
          throw new Error('Cannot suggest.');
        }),
        hinting('fixture/fine', () => 'still here'),
      ],
      views: [override(UsageError, breaks)],
    }).action(dispatch),
  'broken-view-multiline': () =>
    routed({
      views: [
        override(UsageError, {
          render: () => {
            throw new Error(multiline);
          },
        }),
      ],
    }).action(dispatch),
  'broken-view-unreadable': () =>
    routed({
      views: [
        override(UsageError, {
          render: () => {
            throw unreadable.getter();
          },
        }),
      ],
    }).action(dispatch),
  'build-fault': () =>
    new Application('store', {
      plugins: [hinting('fixture/one', () => 'never')],
      views: [override(LoomError, where)],
    }),
  // The caller cancels, then the action fails with its own failure, which still renders.
  'cancelled-broken': () =>
    new Application('store', {
      plugins: [
        hinting('fixture/broken', () => {
          throw new Error('Cannot suggest.');
        }),
        hinting('fixture/fine', () => 'still here'),
      ],
    }).action(() => {
      controller.abort(new Error('the caller stopped the run'));
      throw new FatalError('The action failed.');
    }),
  // The caller cancels and the action rejects with the signal's reason, which reports nothing.
  'cancelled-silent': () =>
    new Application('store', {
      plugins: [hinting('fixture/one', () => 'never')],
    }).action(({ signal }) => {
      controller.abort(new Error('the caller stopped the run'));
      throw signal.reason;
    }),
  candidates: () => routed({ plugins: [hinting('fixture/suggest', suggest)] }).action(dispatch),
  context: () => routed({ views: [override(LoomError, where)] }).action(dispatch),
  'default-rejected': () =>
    new Application('store', {
      plugins: [
        hinting('fixture/one', (failure, { command }) => `command at [${command.path.join(',')}]`),
      ],
    })
      .option('level', { default: 'loud', type: 'string', validate: refuses })
      .action(dispatch),
  'issue-fields': () =>
    new Application('store', { views: [override(InputError, issues)] })
      .command(
        new Command('tag').argument('names', { validate: coded, variadic: true }).action(dispatch),
      )
      .command(
        new Command('label')
          .option('name', { multiple: true, type: 'string', validate: coded })
          .action(dispatch),
      ),
  'lying-filter': () => broken(() => Lying.of('held')),
  'marked-hint': () =>
    routed({
      plugins: [hinting('fixture/one', (failure, { style }) => `plain ${style.bold('bold')}`)],
      rendering: { modifiers: 'always' },
    }).action(dispatch),
  none: () =>
    routed({
      plugins: [hinting('fixture/one', () => undefined), hinting('fixture/two', () => [])],
    }).action(dispatch),
  'not-function': () => plugin('@acme/suggest', { onFailure: 'suggest' }),
  'override-hints': () =>
    routed({
      plugins: [hinting('fixture/one', () => ['first', 'second'])],
      views: [override(UsageError, bracketed)],
    }).action(dispatch),
  plain: () => routed().action(dispatch),
  proxied: () => broken(() => proxied(['held'])),
  // A middleware and the hook read the same graph, built once for the run.
  'shared-graph': () => {
    let seen = null;
    const reader = plugin('fixture/reader', {
      middleware: {
        activate: 'always',
        load: async () => ({
          default: async ({ graph, next }) => {
            seen = graph;
            await next();
          },
        }),
      },
    });
    return new Application('store', {
      plugins: [
        reader,
        hinting('fixture/one', (failure, { graph }) => `same graph: ${String(graph === seen)}`),
      ],
    }).action(({ out }) => out.fatal('The action failed.'));
  },
  // A takeover never raises the held unknown-option fault.
  takeover: () =>
    routed({
      plugins: [
        plugin('fixture/help', {
          middleware: {
            activate: ['help'],
            load: async () => ({ default: ({ out }) => out.print('help') }),
          },
          options: { help: { type: 'boolean' } },
        }),
        hinting('fixture/one', () => 'never'),
      ],
    }).action(dispatch),
  'two-broken': () =>
    routed({
      plugins: [
        hinting('fixture/first', () => {
          throw new Error('First failed.');
        }),
        hinting('fixture/fine', () => 'still here'),
        hinting('fixture/second', () => 7),
      ],
    }).action(dispatch),
  'two-plugins': () =>
    routed({
      plugins: [
        hinting('fixture/one', () => ['first', 'shared']),
        hinting('fixture/two', () => 'shared'),
      ],
    }).action(dispatch),
};

const build = scenarios[scenario];
if (build === undefined) {
  throw new Error(`Unknown scenario: ${scenario}`);
}
// A declaration that throws reports its fault and ends the fixture here.
const app = declare(build);
const code = await app.run({ host: { argv }, signal: controller.signal });
for (const call of calls) {
  process.stdout.write(`${call}\n`);
}
process.stdout.write(`resolved:${code}\n`);
