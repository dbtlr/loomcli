import {
  Application,
  DeclarationError,
  EX_UNAVAILABLE,
  extension,
  FatalError,
  InputError,
  LoomError,
  override,
  plugin,
  translate,
} from '@loomcli/core';
import { z } from 'zod';

const [scenario, ...argv] = process.argv.slice(2);

/** Every translator call and middleware observation, in order, printed ahead of the code. */
const calls = [];

/** The caller's own controller, which the cancelling scenario aborts from its action. */
const controller = new AbortController();

/** The author's failure a translator answers with, which declares a sysexits code. */
class UnavailableError extends FatalError {
  static exitCode = EX_UNAVAILABLE;

  constructor(from, options) {
    super(`Unavailable from ${from}.`, options);
    this.name = 'UnavailableError';
  }
}

/** A translation that records its call and answers with a failure that names who answered. */
function answering(Key, from) {
  return translate(Key, (error) => {
    calls.push(`${from}:${error.constructor.name}`);
    return new UnavailableError(from);
  });
}

/** A translation that records its call and passes the throw on. */
function passing(Key, from) {
  return translate(Key, () => {
    calls.push(`${from}:pass`);
    return undefined;
  });
}

/** A plugin whose only contribution is its translators. */
function contributing(identity, translators) {
  return plugin(identity, { translators });
}

/** A plugin whose middleware is the function a scenario supplies. */
function wrapping(identity, middleware) {
  return plugin(identity, {
    middleware: { activate: 'always', load: async () => ({ default: middleware }) },
  });
}

const foreign = () => {
  throw new SyntaxError('Unexpected token.');
};

const dispatch = ({ out }) => out.print('dispatched');

/** A row source that yields one row and then throws what `JSON.parse` throws. */
async function* brokenRows() {
  yield { name: 'one' };
  throw new SyntaxError('Unexpected token.');
}

/** The binding a configuration source answers through. */
const sourceKey = extension('@fixture/translators/key', { schema: z.string(), target: 'option' });

/** An application whose configuration source runs `resolver`, beside the plugins a case adds. */
function sourcing(resolver, options = {}) {
  const source = plugin('@fixture/source', {
    extensions: [sourceKey],
    source: { binding: sourceKey, load: async () => ({ default: resolver }) },
  });
  return new Application('translators', {
    ...options,
    plugins: [source, ...(options.plugins ?? [])],
  })
    .globalOption('limit', { extensions: [sourceKey('limit')], type: 'string' })
    .action(dispatch);
}

/** A translation that answers every object with a prototype chain, so any offer shows. */
const catchAll = answering(Object, 'catch-all');

function ending(action, options = {}) {
  return new Application('translators', options).action(action);
}

/** Each broken translator, keyed by the scenario that registers it. */
const brokenTranslators = {
  'broken-promise': () => Promise.reject(new Error('The promise rejected.')),
  'broken-string': () => 'text',
  'broken-throws': () => {
    throw new Error('The translator failed.');
  },
  'broken-unconstructed': () => Object.create(FatalError.prototype),
};

/** The throw each reach case raises, where it is raised, with the catch-all registered. */
const unreached = {
  answers: () =>
    sourcing(
      async () => ({
        get limit() {
          throw new Error('The getter failed.');
        },
      }),
      { translators: [catchAll] },
    ),
  cancelled: () =>
    ending(
      ({ signal }) => {
        controller.abort();
        throw signal.reason;
      },
      { translators: [catchAll] },
    ),
  fatal: () =>
    ending(
      () => {
        throw new FatalError('Stopped.');
      },
      { translators: [catchAll] },
    ),
  hook: () =>
    ending(
      () => {
        throw new FatalError('Stopped.');
      },
      {
        plugins: [
          plugin('@fixture/hook', {
            onFailure: () => {
              throw new Error('The hook failed.');
            },
          }),
        ],
        translators: [catchAll],
      },
    ),
  loader: () =>
    ending(dispatch, {
      plugins: [
        plugin('@fixture/loader', {
          middleware: {
            activate: 'always',
            load: () => Promise.reject(new Error('The module is missing.')),
          },
        }),
      ],
      translators: [catchAll],
    }),
  'null-prototype': () =>
    ending(
      () => {
        throw Object.create(null);
      },
      { translators: [catchAll] },
    ),
  render: () =>
    ending(
      async ({ out }) => {
        await out.render('data', {
          render: () => {
            throw new Error('The view failed.');
          },
        });
      },
      { translators: [catchAll] },
    ),
  string: () =>
    ending(
      () => {
        throw 'text';
      },
      { translators: [catchAll] },
    ),
  unwinding: () =>
    ending(dispatch, {
      plugins: [
        wrapping('@fixture/unwinding', async ({ next }) => {
          await next();
          throw new Error('The unwinding failed.');
        }),
      ],
      translators: [catchAll],
    }),
  validator: () =>
    new Application('translators', { translators: [catchAll] })
      .option('level', {
        type: 'string',
        validate: {
          '~standard': {
            validate: () => {
              throw new Error('The validator failed.');
            },
            vendor: 'fixture',
            version: 1,
          },
        },
      })
      .action(dispatch),
  view: () =>
    ending(
      () => {
        throw new FatalError('Stopped.');
      },
      {
        translators: [catchAll],
        views: [
          override(FatalError, {
            render: () => {
              throw new Error('The view failed.');
            },
          }),
        ],
      },
    ),
};

/** A hook that reports the cause the translated failure carries. */
const causeReader = plugin('@fixture/cause', {
  onFailure: (failure) => {
    calls.push(
      'cause' in failure
        ? `cause:${failure.cause?.constructor.name}:${failure.cause?.message}`
        : 'cause:none',
    );
    return undefined;
  },
});

/** Each scenario's application. */
function build() {
  if (scenario in unreached) {
    return unreached[scenario]();
  }
  if (scenario in brokenTranslators) {
    return ending(foreign, {
      plugins: [contributing('@fixture/later', [answering(SyntaxError, 'later')])],
      translators: [translate(SyntaxError, brokenTranslators[scenario])],
    });
  }
  switch (scenario) {
    case 'action': {
      return ending(foreign, { translators: [answering(SyntaxError, 'application')] });
    }
    case 'untranslated': {
      return ending(
        () => {
          throw new TypeError('The value is not a function.');
        },
        { translators: [answering(SyntaxError, 'application')] },
      );
    }
    case 'middleware': {
      return ending(dispatch, {
        plugins: [wrapping('@fixture/throwing', foreign)],
        translators: [answering(SyntaxError, 'application')],
      });
    }
    case 'source': {
      return sourcing(foreign, { translators: [answering(SyntaxError, 'application')] });
    }
    case 'source-takeover': {
      return sourcing(foreign, {
        plugins: [
          wrapping('@fixture/takeover', ({ out }) => {
            out.print('took over');
          }),
        ],
        translators: [answering(SyntaxError, 'application')],
      });
    }
    case 'raw': {
      return ending(foreign, {
        plugins: [
          wrapping('@fixture/watching', async ({ next }) => {
            try {
              await next();
            } catch (error) {
              calls.push(`caught:${error.constructor.name}`);
              throw error;
            }
          }),
        ],
        translators: [answering(SyntaxError, 'application')],
      });
    }
    case 'caught': {
      return ending(foreign, {
        plugins: [
          wrapping('@fixture/catching', async ({ next }) => {
            await next().catch((error) => {
              calls.push(`caught:${error.constructor.name}`);
            });
          }),
        ],
        translators: [answering(SyntaxError, 'application')],
      });
    }
    case 'order-shared': {
      return ending(foreign, {
        plugins: [contributing('@fixture/plugin', [answering(SyntaxError, 'plugin')])],
        translators: [answering(SyntaxError, 'application')],
      });
    }
    case 'order-base': {
      return ending(foreign, {
        plugins: [contributing('@fixture/plugin', [answering(SyntaxError, 'plugin')])],
        translators: [answering(Error, 'application')],
      });
    }
    case 'order-plugins': {
      return ending(foreign, {
        plugins: [
          contributing('@fixture/first', [answering(SyntaxError, 'first')]),
          contributing('@fixture/second', [answering(SyntaxError, 'second')]),
        ],
      });
    }
    case 'order-derived': {
      return ending(foreign, {
        translators: [
          answering(Error, 'base'),
          passing(SyntaxError, 'derived-one'),
          answering(SyntaxError, 'derived-two'),
        ],
      });
    }
    case 'order-next': {
      return ending(foreign, {
        plugins: [contributing('@fixture/plugin', [answering(SyntaxError, 'plugin')])],
        translators: [passing(SyntaxError, 'application')],
      });
    }
    case 'broken-plugin': {
      return ending(foreign, {
        plugins: [
          contributing('@fixture/broken', [
            translate(SyntaxError, () => {
              throw new Error('The translator failed.');
            }),
          ]),
          contributing('@fixture/later', [answering(SyntaxError, 'later')]),
        ],
      });
    }
    case 'cause': {
      return ending(foreign, {
        plugins: [causeReader],
        translators: [
          translate(SyntaxError, (error) => new UnavailableError('cause', { cause: error })),
        ],
      });
    }
    case 'no-cause': {
      return ending(foreign, {
        plugins: [causeReader],
        translators: [answering(SyntaxError, 'application')],
      });
    }
    case 'sequence': {
      return new Application('translators', {
        translators: [answering(SyntaxError, 'application')],
      })
        .rows({ views: { lines: { row: (row) => `${row.name}\n` } } })
        .action(async ({ out }) => {
          await out.results(brokenRows());
        });
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

/** Each declaration fault, which a case constructs outside a run. */
const faults = {
  'fault-application': () => new Application('translators', { translators: ['text'] }),
  'fault-application-list': () => new Application('translators', { translators: 'text' }),
  'fault-key': () =>
    translate(
      () => undefined,
      () => undefined,
    ),
  'fault-plugin': () => plugin('@acme/http', { translators: ['text'] }),
  'fault-plugin-list': () => plugin('@acme/http', { translators: 'text' }),
  'fault-translator': () => translate(SyntaxError, 'text'),
};

if (scenario in faults) {
  try {
    faults[scenario]();
    process.stdout.write('constructed\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'DeclarationError' : 'other';
    process.stdout.write(`thrown:${kind}: ${error.message}\n`);
  }
} else if (scenario === 'error-options') {
  // The failure classes an author constructs keep a cause only when one is passed.
  const cause = new SyntaxError('Unexpected token.');
  class DocumentError extends LoomError {
    constructor(options) {
      super('The document is broken.', options);
      this.name = 'DocumentError';
    }
  }
  const failures = {
    DeclarationError: new DeclarationError('Declared wrong.', { cause }),
    DocumentError: new DocumentError({ cause }),
    FatalError: new FatalError('Stopped.', { cause }),
    InputError: new InputError('Bad input.', [], { cause }),
  };
  const seen = Object.fromEntries(
    Object.entries(failures).map(([name, failure]) => [name, failure.cause === cause]),
  );
  seen.uncaused = 'cause' in new FatalError('Stopped.');
  process.stdout.write(`${JSON.stringify(seen)}\n`);
} else {
  const code = await build().run({ host: { argv }, signal: controller.signal });
  for (const call of calls) {
    process.stdout.write(`${call}\n`);
  }
  process.stdout.write(`resolved:${code}\n`);
}
