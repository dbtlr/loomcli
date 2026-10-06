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

/** A validator whose converter throws when build asks it for the input's schema. */
const throwingConverter = {
  '~standard': {
    jsonSchema: {
      input: () => {
        throw new Error('This shape has no JSON Schema.');
      },
      output: () => ({}),
    },
    validate: (value) => ({ value }),
    vendor: 'fixture',
    version: 1,
  },
};

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
  const clear = new Command('clear', {
    description: 'The clear command.',
  })
    .option('keep', { description: 'The keep option.', short: 'k', type: 'boolean' })
    .option('secret', { description: 'The secret option.', hidden: true, type: 'boolean' })
    .option('old', {
      deprecated: 'Use --keep instead.',
      description: 'The old option.',
      type: 'boolean',
    })
    .action(dispatch);
  const cache = new Command('cache', {
    description: 'The cache command.',
  })
    .command(clear)
    .command(
      new Command('purge', { description: 'The purge command.', hidden: true }).action(dispatch),
    )
    .command(
      new Command('list', { description: 'The list command.' }).alias('ls').action(dispatch),
    );
  return new Application('store', { description: 'Store values.', ...options })
    .globalOption('file', { description: 'The file option.', short: 'f', type: 'string' })
    .globalOption('trace', { description: 'The trace option.', hidden: true, type: 'boolean' })
    .globalOption('legacy', {
      deprecated: 'Use --file instead.',
      description: 'The legacy option.',
      type: 'boolean',
    })
    .command(cache);
}

// A test that reads a broken contract's own sentence runs the fixture as a development build.
const packet =
  process.env.FIXTURE_BUILD === undefined ? {} : { packet: { build: process.env.FIXTURE_BUILD } };

/** A broken hook installed ahead of a working one, on a graph whose fault is a usage error. */
function broken(answer) {
  return routed({
    ...packet,
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
      description: 'The store application.',
      plugins: [twice, hinting('fixture/one', (failure) => `hint for ${failure.name}`)],
    }).action(({ out }) => out.fatal('The action failed.')),
  // A JavaScript hook steps outside the contract and assigns the code, which core already read.
  'assigns-exit-code': () =>
    routed({
      plugins: [
        hinting('fixture/one', (failure) => {
          // The instance code is an accessor without a setter, so this strict mode assignment throws.
          // The hook catches it to show that no assignment reaches the code run() resolves.
          try {
            failure.exitCode = 0;
          } catch {
            // Ignored: the resolved code stays the class's.
          }
          return 'hinted';
        }),
      ],
    }).action(dispatch),
  'broken-array': () => broken(() => ['fine', 7]),
  'broken-callable-thenable': () =>
    // A function with a callable then is a thenable under Promises/A+, so the shape is the fixture.
    // oxlint-disable-next-line unicorn/no-thenable
    broken(() => Object.assign(() => undefined, { then: () => undefined })),
  'broken-controls': () =>
    broken(() => {
      throw new Error(`red${controls}end`);
    }),
  'broken-hole': () =>
    // Index 1 of three is never assigned, so the list holds a hole there.
    broken(() => Object.assign([], { 0: 'a', 2: 'c' })),
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
      description: 'The store application.',
      plugins: [hinting('fixture/one', () => 'never')],
      views: [override(LoomError, where)],
    }),
  // The caller cancels, then the action fails with its own failure, which still renders.
  'cancelled-broken': () =>
    new Application('store', {
      description: 'The store application.',
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
      description: 'The store application.',
      plugins: [hinting('fixture/one', () => 'never')],
    }).action(({ signal }) => {
      controller.abort(new Error('the caller stopped the run'));
      throw signal.reason;
    }),
  candidates: () => routed({ plugins: [hinting('fixture/suggest', suggest)] }).action(dispatch),
  context: () => routed({ views: [override(LoomError, where)] }).action(dispatch),
  // A development build asks every converter at build, so a converter that throws is a build fault.
  'converter-fault': () =>
    new Application('store', {
      description: 'The store application.',
      packet: { build: 'development' },
      plugins: [hinting('fixture/one', () => 'converter-fault hint')],
    })
      .option('mode', {
        description: 'The mode option.',
        type: 'string',
        validate: throwingConverter,
      })
      .action(dispatch),
  'default-rejected': () =>
    new Application('store', {
      description: 'The store application.',
      plugins: [
        hinting('fixture/one', (_failure, { command }) => `command at [${command.path.join(',')}]`),
      ],
    })
      .option('level', {
        default: 'loud',
        description: 'The level option.',
        type: 'string',
        validate: refuses,
      })
      .action(dispatch),
  'issue-fields': () =>
    new Application('store', {
      description: 'The store application.',
      views: [override(InputError, issues)],
    })
      .command(
        new Command('tag', { description: 'The tag command.' })
          .argument('names', {
            description: 'The names argument.',
            validate: coded,
            variadic: true,
          })
          .action(dispatch),
      )
      .command(
        new Command('label', {
          description: 'The label command.',
        })
          .option('name', {
            description: 'The name option.',
            multiple: true,
            type: 'string',
            validate: coded,
          })
          .action(dispatch),
      ),
  'lying-filter': () => broken(() => Lying.of('held')),
  'marked-hint': () =>
    routed({
      plugins: [hinting('fixture/one', (_failure, { style }) => `plain ${style.bold('bold')}`)],
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
      description: 'The store application.',
      plugins: [
        reader,
        hinting('fixture/one', (_failure, { graph }) => `same graph: ${String(graph === seen)}`),
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
  // Two rejected options, so one input failure writes two problem lines above the hints.
  'two-problems': () =>
    new Application('store', {
      description: 'The store application.',
      plugins: [hinting('fixture/one', () => ['first', 'second'])],
    })
      .option('left', { description: 'The left option.', type: 'string', validate: refuses })
      .option('right', { description: 'The right option.', type: 'string', validate: refuses })
      .action(dispatch),
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
