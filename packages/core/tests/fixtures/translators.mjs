import { Writable } from 'node:stream';

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

import { ruleText } from './rule-text.mjs';

const [scenario, ...argv] = process.argv.slice(2);

// A test that reads a defect's own diagnostic runs the fixture as a development build.
const packet =
  process.env.FIXTURE_BUILD === undefined ? {} : { packet: { build: process.env.FIXTURE_BUILD } };

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

/** A row source that yields one row and then throws a failure, which no translator is offered. */
async function* failingRows() {
  yield { name: 'one' };
  throw new UnavailableError('source');
}

/** A row source that yields one row and then throws `undefined`, which no translator answers. */
async function* undefinedRows() {
  yield { name: 'one' };
  throw undefined;
}

/** A rows Command whose action hands `source` to out.results() the way `emit` does. */
function sequencing(emit, source, translators = [answering(SyntaxError, 'application')]) {
  return new Application('translators', {
    description: 'The translators application.',
    ...packet,
    translators,
  })
    .rows({ views: { lines: { row: (row) => `${row.name}\n` } } })
    .action(({ out }) => emit(out.results(source())));
}

/** What a write to a closed pipe fails with, as `write EPIPE` does. */
class PipeError extends Error {
  constructor() {
    super('write EPIPE');
    this.name = 'PipeError';
    this.code = 'EPIPE';
  }
}

/** The stdout a scenario replaces, or `undefined` for the process's own. */
let stdout = undefined;

/** The binding a configuration source answers through. */
const sourceKey = extension('@fixture/translators/key', { schema: z.string(), target: 'option' });

/** An application whose configuration source runs `resolver`, beside the plugins a case adds. */
function sourcing(resolver, options = {}) {
  const source = plugin('@fixture/source', {
    extensions: [sourceKey],
    source: { binding: sourceKey, load: async () => ({ default: resolver }) },
  });
  return new Application('translators', {
    description: 'The translators application.',
    ...packet,
    ...options,
    plugins: [source, ...(options.plugins ?? [])],
  })
    .globalOption('limit', {
      description: 'The limit option.',
      extensions: [sourceKey('limit')],
      type: 'string',
    })
    .action(dispatch);
}

/** A translation that answers every object with a prototype chain, so any offer shows. */
const catchAll = answering(Object, 'catch-all');

function ending(action, options = {}) {
  return new Application('translators', {
    description: 'The translators application.',
    ...packet,
    ...options,
  }).action(action);
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

/** A thrown proxy whose prototype trap answers itself `repeats` times, and then `Object.prototype`. */
function selfReferencing(repeats) {
  let reads = 0;
  const proxy = new Proxy(
    {},
    { getPrototypeOf: () => (++reads > repeats ? Object.prototype : proxy) },
  );
  return proxy;
}

/** A chain of `links` distinct proxies that ends at `Object.prototype`. */
function longChain(links) {
  let link = Object.prototype;
  for (let index = 0; index < links; index += 1) {
    const next = link;
    link = new Proxy({}, { getPrototypeOf: () => next });
  }
  return link;
}

/** A thrown `SyntaxError` whose prototype trap throws on every read after its first. */
function closingProxy() {
  let reads = 0;
  return new Proxy(new SyntaxError('Unexpected token.'), {
    getPrototypeOf(target) {
      reads += 1;
      if (reads > 1) {
        throw new Error('The trap closed.');
      }
      return Reflect.getPrototypeOf(target);
    },
  });
}

/** An Error whose `name` getter throws. */
function unnamed() {
  const error = new Error('Unnamed.');
  Object.defineProperty(error, 'name', {
    get() {
      throw new Error('The name getter failed.');
    },
  });
  return error;
}

/** A `SyntaxError` subclass whose class name holds a bidirectional control. */
class EscapedError extends SyntaxError {
  constructor(message) {
    super(message);
    this.name = 'EscapedError';
  }
}
Object.defineProperty(EscapedError, 'name', { value: 'Escaped‮Error' });

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
  'cancelled-name': () =>
    ending(
      () => {
        controller.abort();
        throw unnamed();
      },
      { translators: [catchAll] },
    ),
  'closing-proxy': () =>
    ending(
      () => {
        throw closingProxy();
      },
      { translators: [catchAll] },
    ),
  cycle: () =>
    ending(
      () => {
        throw selfReferencing(3);
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
  'long-chain': () =>
    ending(
      () => {
        throw longChain(2000);
      },
      { translators: [catchAll] },
    ),
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
    new Application('translators', {
      description: 'The translators application.',
      ...packet,
      translators: [catchAll],
    })
      .option('level', {
        description: 'The level option.',
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
  'validator-output': () =>
    new Application('translators', {
      description: 'The translators application.',
      ...packet,
      translators: [catchAll],
    })
      .option('doc', {
        description: 'The doc option.',
        type: 'string',
        validate: {
          '~standard': {
            // The value's getter throws when core snapshots the request, after the validator returned.
            validate: (raw) => ({
              value: {
                get parsed() {
                  return JSON.parse(raw);
                },
              },
            }),
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

/** The original throw and the translator's throw of the defect-cause scenarios, kept by identity. */
const defectThrows = {
  original: new SyntaxError('Unexpected token.'),
  translator: new Error('The translator failed.'),
};

/** A hook that reports how the broken-translator defect's cause holds the two throws. */
const defectCauseReader = plugin('@fixture/defect-cause', {
  onFailure: (failure) => {
    const { cause } = failure;
    if (cause === defectThrows.original) {
      calls.push('cause:original');
    } else if (cause instanceof AggregateError) {
      const [first, second, ...rest] = cause.errors;
      const exact =
        first === defectThrows.translator && second === defectThrows.original && rest.length === 0;
      calls.push(`cause:AggregateError:${exact ? 'translator,original' : 'other'}`);
    } else {
      calls.push('cause:other');
    }
    return undefined;
  },
});

/** An application whose action throws the kept original throw at the translator `broken`. */
function defectCause(broken) {
  return ending(
    () => {
      throw defectThrows.original;
    },
    { plugins: [defectCauseReader], translators: [translate(SyntaxError, broken)] },
  );
}

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
    case 'broken-escaped': {
      return ending(
        () => {
          throw new EscapedError('Unexpected token.');
        },
        {
          translators: [
            translate(EscapedError, () => {
              throw new Error('The translator failed\r\nforged\u202eline');
            }),
          ],
        },
      );
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
    case 'defect-cause-throws': {
      return defectCause(() => {
        throw defectThrows.translator;
      });
    }
    case 'defect-cause-returned': {
      return defectCause(() => 'text');
    }
    case 'sequence': {
      return new Application('translators', {
        description: 'The translators application.',
        ...packet,
        translators: [answering(SyntaxError, 'application')],
      })
        .rows({ views: { lines: { row: (row) => `${row.name}\n` } } })
        .action(async ({ out }) => {
          await out.results(brokenRows());
        });
    }
    case 'sequence-unawaited': {
      return sequencing((pending) => {
        void pending;
      }, brokenRows);
    }
    case 'sequence-caught': {
      return sequencing(async (pending) => {
        try {
          await pending;
        } catch {
          calls.push('caught');
        }
      }, brokenRows);
    }
    case 'sequence-broken': {
      return sequencing(
        (pending) => {
          void pending;
        },
        brokenRows,
        [translate(SyntaxError, brokenTranslators['broken-throws'])],
      );
    }
    case 'sequence-undefined': {
      return sequencing((pending) => {
        void pending;
      }, undefinedRows);
    }
    case 'sequence-failure': {
      return sequencing(
        (pending) => {
          void pending;
        },
        failingRows,
        [catchAll],
      );
    }
    case 'destination': {
      stdout = new Writable({
        write(chunk, encoding, callback) {
          callback(new PipeError());
        },
      });
      return ending(
        async ({ out }) => {
          await out.print('lost');
        },
        { translators: [answering(PipeError, 'application')] },
      );
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

/** A `translators` list that holds `before`, then a hole, then `after`. */
function holey(before, after) {
  const list = [...before];
  list.length += 1;
  list.push(...after);
  return list;
}

/** A class whose static `name` getter throws. */
class NamelessKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NamelessKeyError';
  }
}
Object.defineProperty(NamelessKeyError, 'name', {
  get() {
    throw new Error('The name getter failed.');
  },
});

/** An error class whose `prototype` cannot be read, through the trap the case names. */
function unreadablePrototypeKey(trap) {
  return new Proxy(class extends Error {}, {
    [trap](target, key, ...rest) {
      if (key === 'prototype') {
        throw new Error('The prototype trap failed.');
      }
      return Reflect[trap](target, key, ...rest);
    },
  });
}

/** A constructor whose prototype's chain cannot be read, because the proxy's getPrototypeOf trap throws. */
function ChainKeyError() {}
ChainKeyError.prototype = new Proxy(Object.create(Error.prototype), {
  getPrototypeOf() {
    throw new Error('The chain trap failed.');
  },
});

/** Each declaration fault, which a case constructs outside a run. */
const faults = {
  'fault-application': () =>
    new Application('translators', {
      description: 'The translators application.',
      translators: ['text'],
    }),
  'fault-application-hole': () =>
    new Application('translators', {
      description: 'The translators application.',
      translators: holey([], []),
    }),
  'fault-application-list': () =>
    new Application('translators', {
      description: 'The translators application.',
      translators: 'text',
    }),
  'fault-key': () =>
    translate(
      () => undefined,
      () => undefined,
    ),
  'fault-key-chain': () => translate(ChainKeyError, () => undefined),
  'fault-key-failure': () => translate(LoomError, () => undefined),
  'fault-key-fatal': () => translate(FatalError, () => undefined),
  'fault-key-get': () => translate(unreadablePrototypeKey('get'), () => undefined),
  'fault-key-has': () => translate(unreadablePrototypeKey('has'), () => undefined),
  'fault-key-subclass': () => translate(UnavailableError, () => undefined),
  'fault-plugin': () => plugin('@acme/http', { translators: ['text'] }),
  'fault-plugin-hole': () => plugin('@acme/http', { translators: holey([catchAll], [catchAll]) }),
  'fault-plugin-list': () => plugin('@acme/http', { translators: 'text' }),
  'fault-translator': () => translate(SyntaxError, 'text'),
  'key-name': () => translate(NamelessKeyError, () => undefined),
};

if (scenario in faults) {
  try {
    faults[scenario]();
    process.stdout.write('constructed\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'DeclarationError' : 'other';
    process.stdout.write(`thrown:${kind}: ${ruleText(error)}\n`);
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
  const application = build();
  const host = stdout === undefined ? { argv } : { argv, stdout };
  const code = await application.run({ host, signal: controller.signal });
  for (const call of calls) {
    process.stdout.write(`${call}\n`);
  }
  process.stdout.write(`resolved:${code}\n`);
}
