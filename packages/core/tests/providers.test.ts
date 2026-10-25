/**
 * Acceptance plan for providers (docs/core/providers.md, ADR-0108), proven in the test's own
 * process on `mockProcess`, under Node and Bun:
 *
 * - Opting in. An action reads each value its Command's `uses` lists under `provided`, and a value
 *   a listed provider uses is built and not provided. An opener receives the validated global
 *   options, the values of the providers it uses, the host, `log`, the signal, and `onShutdown`. A
 *   provider reached twice is built once, and the Application's `uses` covers the root's action.
 * - Nothing before the boundary. A takeover, a held input fault, and a Command that opts in to
 *   nothing build nothing, and the last reads `{}`.
 * - Lifetimes. A nested `invoke` shares a persistent value and rebuilds an ephemeral one, and two
 *   first uses at once share one build. A persistent opener reads the outermost run's options. Each
 *   `app.invoke` is an outermost run of its own, and a failed persistent build is built again by
 *   the next run that needs it.
 * - Closing. Values close in reverse build order, ephemeral before persistent, after the action's
 *   regions close and before a middleware's code after `next()`. `close` replaces the disposal
 *   protocol, `Symbol.asyncDispose` comes before `Symbol.dispose`, and a value with none is left.
 * - Failures. A throwing opener or `load` closes what was built, never dispatches the action, and
 *   takes the ordinary failure path: a FatalError keeps its code and a translator is offered any
 *   other throw. A close that throws fails a run that had succeeded, and on a run that already
 *   failed it is an `error` log event naming the provider, as is every close after the first throw.
 * - Cancellation. A signal that aborts during a build lets the opener in flight settle, starts no
 *   further build, closes what was built, and never dispatches the action, so the run resolves its
 *   cancellation code; a rejection with the signal's reason is silent, and any other is reported.
 * - A shutdown. A close still running when the shutdown budget runs out is cut off.
 */
import { mockProcess } from '@loomcli/testing';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  Application,
  Command,
  EX_DATAERR,
  EX_SOFTWARE,
  EX_TEMPFAIL,
  EX_UNAVAILABLE,
  FatalError,
  plugin,
  provider,
  translate,
} from '../src/index.js';
import type { LogEvent, Middleware, Plugin, Provider, Region } from '../src/index.js';

/** A failure the database raises, which exits 69. */
class UnavailableError extends FatalError {
  static override readonly exitCode = EX_UNAVAILABLE;

  constructor(message: string) {
    super(message);
    this.name = 'UnavailableError';
  }
}

/** A failure a translator answers, which exits 70. */
class BrokenError extends FatalError {
  static override readonly exitCode = EX_SOFTWARE;

  constructor(message: string) {
    super(message);
    this.name = 'BrokenError';
  }
}

/** A failure a close raises, which exits 75. */
class BusyError extends FatalError {
  static override readonly exitCode = EX_TEMPFAIL;

  constructor(message: string) {
    super(message);
    this.name = 'BusyError';
  }
}

/** A failure the action raises, which exits 65. */
class RejectedError extends FatalError {
  static override readonly exitCode = EX_DATAERR;

  constructor(message: string) {
    super(message);
    this.name = 'RejectedError';
  }
}

/** A list every provider in a test appends its events to, in order. */
function journal(): string[] {
  return [];
}

/** A value that records its close through the disposal protocol. */
function disposable(
  lines: string[],
  name: string,
): { name: string; [Symbol.asyncDispose]: () => Promise<void> } {
  return {
    name,
    [Symbol.asyncDispose]: async () => {
      lines.push(`close ${name}`);
    },
  };
}

/** An ephemeral provider with no inputs whose opener records its build and returns a disposable. */
function recorded<const Name extends string>(
  lines: string[],
  name: Name,
): Provider<Name, { name: string }> {
  return provider<Provider<Name, { name: string }>>(name, {
    load: async () => ({
      default: () => {
        lines.push(`open ${name}`);
        return disposable(lines, name);
      },
    }),
  });
}

/** Runs an Application on a fresh mock with the given argv. */
async function run(
  app: { run: Application['run'] },
  argv: readonly string[] = [],
): Promise<{ code: number; stderr: string; stdout: string }> {
  const mock = mockProcess({ argv: [...argv] });
  const code = await app.run({ process: mock });
  return { code, stderr: mock.stderr.text, stdout: mock.stdout.text };
}

/** A plugin whose `onLog` collects every event a run logs. */
function collecting(events: LogEvent[]): Plugin {
  return plugin('test/collecting', {
    onLog: (event) => {
      events.push(event);
    },
  });
}

/** A persistent pool and an ephemeral session on it, each counting its opens and closes. */
function scoped(lines: string[]) {
  const pool: Provider<'pool', { name: string }, { label: string | undefined }, 'persistent'> =
    provider('pool', {
      lifetime: 'persistent',
      load: async () => ({
        default: ({ options }) => {
          lines.push(`open pool ${options.label ?? ''}`);
          return disposable(lines, 'pool');
        },
      }),
    });
  const session: Provider<'session', { name: string }, {}, 'ephemeral', [typeof pool]> = provider(
    'session',
    {
      load: async () => ({
        default: () => {
          lines.push('open session');
          return disposable(lines, 'session');
        },
      }),
      uses: [pool],
    },
  );
  return { pool, session };
}

/** A provider whose close throws a Busy failure with the message given. */
function throwing(name: string, message: string): Provider<string, string> {
  return provider<Provider<string, string>>(name, {
    close: () => {
      throw new BusyError(message);
    },
    load: async () => ({ default: () => name }),
  });
}

describe('opting in', () => {
  it('reads each listed value under provided and builds a dependency without providing it', async () => {
    const lines = journal();
    const base = recorded(lines, 'base');
    const derived: Provider<'derived', string, {}, 'ephemeral', [typeof base]> = provider(
      'derived',
      {
        load: async () => ({
          default: ({ provided }) => `derived from ${provided.base.name}`,
        }),
        uses: [base],
      },
    );
    const app = new Application('app').command(
      new Command('get', { uses: [derived] }).action(({ provided }) => {
        lines.push(`action ${provided.derived} ${Object.keys(provided).join(',')}`);
      }),
    );
    const { code } = await run(app, ['get']);
    expect(code).toBe(0);
    expect(lines).toEqual(['open base', 'action derived from base derived', 'close base']);
  });

  it('hands an opener the validated globals, the host, log, the signal, and onShutdown', async () => {
    const seen: string[] = [];
    const events: LogEvent[] = [];
    const token: Provider<'token', string, { token: string | undefined }> = provider('token', {
      load: async () => ({
        default: ({ host, log, onShutdown, options, signal }) => {
          log.info('Opening the token.');
          seen.push(
            [
              options.token,
              Object.isFrozen(options),
              host.argv.join(' '),
              signal.aborted,
              typeof onShutdown,
            ].join(' '),
          );
          return `token ${options.token ?? 'none'}`;
        },
      }),
    });
    const app = new Application('app', { plugins: [collecting(events)] })
      .globalOption('token', { type: 'string' })
      .command(
        new Command('get', { uses: [token] }).action(({ options, provided }) => {
          seen.push(`${provided.token} ${options.token ?? ''}`);
        }),
      );
    const { code } = await run(app, ['--token', 'abc', 'get']);
    expect(code).toBe(0);
    expect(seen).toEqual(['abc true --token abc get false function', 'token abc abc']);
    expect(events.map(({ message, plugin: identity }) => [message, identity])).toEqual([
      ['Opening the token.', null],
    ]);
  });

  it('builds a provider reached twice once', async () => {
    const lines = journal();
    const pool = recorded(lines, 'pool');
    const session: Provider<'session', string, {}, 'ephemeral', [typeof pool]> = provider(
      'session',
      {
        load: async () => ({ default: ({ provided }) => `session on ${provided.pool.name}` }),
        uses: [pool],
      },
    );
    const app = new Application('app').command(
      new Command('get', { uses: [session, pool] }).action(({ provided }) => {
        lines.push(`action ${provided.session} ${provided.pool.name}`);
      }),
    );
    const { code } = await run(app, ['get']);
    expect(code).toBe(0);
    expect(lines).toEqual(['open pool', 'action session on pool pool', 'close pool']);
  });

  it("covers the root's own action through the Application's uses", async () => {
    const lines = journal();
    const root = recorded(lines, 'root');
    const app = new Application('app', { uses: [root] }).action(({ provided }) => {
      lines.push(`action ${provided.root.name}`);
    });
    const { code } = await run(app);
    expect(code).toBe(0);
    expect(lines).toEqual(['open root', 'action root', 'close root']);
  });
});

describe('nothing before the boundary', () => {
  const takeover = plugin('test/takeover', {
    middleware: {
      activate: 'always',
      load: async () => ({ default: (() => undefined) satisfies Middleware<Plugin> }),
    },
  });

  it('builds nothing for a takeover', async () => {
    const lines = journal();
    const value = recorded(lines, 'value');
    const app = new Application('app', { plugins: [takeover] }).command(
      new Command('get', { uses: [value] }).action(() => {
        lines.push('action');
      }),
    );
    const { code } = await run(app, ['get']);
    expect(code).toBe(0);
    expect(lines).toEqual([]);
  });

  it('builds nothing for a held input fault', async () => {
    const lines = journal();
    const value = recorded(lines, 'value');
    const app = new Application('app').command(
      new Command('get', { uses: [value] }).argument('id', { required: true }).action(() => {
        lines.push('action');
      }),
    );
    const { code, stderr } = await run(app, ['get']);
    expect(code).toBe(2);
    expect(stderr).toContain('id');
    expect(lines).toEqual([]);
  });

  it('builds nothing for a Command that opts in to nothing, whose action reads {}', async () => {
    const lines = journal();
    const value = recorded(lines, 'value');
    const app = new Application('app')
      .command(new Command('used', { uses: [value] }).action(() => undefined))
      .command(
        new Command('plain').action(({ provided }) => {
          lines.push(`action ${JSON.stringify(provided)}`);
        }),
      );
    const { code } = await run(app, ['plain']);
    expect(code).toBe(0);
    expect(lines).toEqual(['action {}']);
  });
});

describe('lifetimes', () => {
  it('shares a persistent value with a nested invoke and rebuilds an ephemeral one', async () => {
    const lines = journal();
    const { pool, session } = scoped(lines);
    const app = new Application('app')
      .globalOption('label', { type: 'string' })
      .command(
        new Command('child', { uses: [session] }).action(() => {
          lines.push('child');
        }),
      )
      .command(
        new Command('parent', { uses: [pool] }).action(async ({ invoke }) => {
          await invoke(['child'], { options: { label: 'inner' } });
          await invoke(['child'], {});
          lines.push('parent');
        }),
      );
    const { code } = await run(app, ['--label', 'outer', 'parent']);
    expect(code).toBe(0);
    expect(lines).toEqual([
      'open pool outer',
      'open session',
      'child',
      'close session',
      'open session',
      'child',
      'close session',
      'parent',
      'close pool',
    ]);
  });

  it('builds a persistent value first needed in a nested run once, from the outermost options', async () => {
    const lines = journal();
    const { session } = scoped(lines);
    const app = new Application('app')
      .globalOption('label', { type: 'string' })
      .command(
        new Command('child', { uses: [session] }).action(() => {
          lines.push('child');
        }),
      )
      .command(
        new Command('parent').action(async ({ invoke }) => {
          await Promise.all([
            invoke(['child'], { options: { label: 'a' } }),
            invoke(['child'], { options: { label: 'b' } }),
          ]);
          lines.push('parent');
        }),
      );
    const { code } = await run(app, ['--label', 'outer', 'parent']);
    expect(code).toBe(0);
    expect(lines.filter((line) => line.startsWith('open pool'))).toEqual(['open pool outer']);
    expect(lines.slice(-2)).toEqual(['parent', 'close pool']);
  });

  it('builds a persistent value again for each app.invoke', async () => {
    const lines = journal();
    const { pool } = scoped(lines);
    const app = new Application('app')
      .globalOption('label', { type: 'string' })
      .command(new Command('get', { uses: [pool] }).action(() => undefined));
    const process = mockProcess();
    await app.invoke(['get'], { options: { label: 'one' } }, { process });
    await app.invoke(['get'], { options: { label: 'two' } }, { process });
    expect(lines).toEqual(['open pool one', 'close pool', 'open pool two', 'close pool']);
  });

  it('builds a failed persistent value again in the next run that needs it', async () => {
    const lines = journal();
    let attempts = 0;
    const flaky: Provider<'flaky', string, {}, 'persistent'> = provider('flaky', {
      lifetime: 'persistent',
      load: async () => ({
        default: () => {
          attempts += 1;
          if (attempts === 1) {
            throw new UnavailableError('The pool is down.');
          }
          return 'up';
        },
      }),
    });
    const app = new Application('app')
      .command(
        new Command('child', { uses: [flaky] }).action(({ provided }) => {
          lines.push(`child ${provided.flaky}`);
        }),
      )
      .command(
        new Command('parent').action(async ({ invoke }) => {
          const first = await invoke(['child'], {});
          const second = await invoke(['child'], {});
          lines.push(`${first.status} ${second.status}`);
        }),
      );
    const { code } = await run(app, ['parent']);
    expect(code).toBe(0);
    expect(lines).toEqual(['child up', 'failed completed']);
  });
});

describe('closing', () => {
  it('closes in reverse build order, after the regions and before the middleware unwinds', async () => {
    const lines = journal();
    const first = recorded(lines, 'first');
    const second = recorded(lines, 'second');
    let region: Region | undefined = undefined;
    const around = plugin('test/around', {
      middleware: {
        activate: 'always',
        load: async () => ({
          default: (async ({ next }) => {
            await next();
            lines.push('after next');
          }) satisfies Middleware<Plugin>,
        }),
      },
    });
    const probe: Provider<'probe', { name: string }> = provider('probe', {
      close: () => {
        lines.push(`close probe ${region?.closedBy ?? 'open'}`);
      },
      load: async () => ({ default: () => ({ name: 'probe' }) }),
    });
    const app = new Application('app', { plugins: [around] }).command(
      new Command('get', { uses: [probe, first, second] }).action(({ out }) => {
        region = out.region();
        lines.push('action');
      }),
    );
    const { code } = await run(app, ['get']);
    expect(code).toBe(0);
    expect(lines).toEqual([
      'open first',
      'open second',
      'action',
      'close second',
      'close first',
      'close probe completion',
      'after next',
    ]);
  });

  it("closes an action's regions for its failure before its values close", async () => {
    const lines = journal();
    const opened: { region?: Region } = {};
    const probe: Provider<'probe', string> = provider('probe', {
      close: () => {
        lines.push(`close ${opened.region?.closedBy ?? 'open'}`);
      },
      load: async () => ({ default: () => 'probe' }),
    });
    const app = new Application('app').command(
      new Command('get', { uses: [probe] }).action(({ out }) => {
        opened.region = out.region();
        throw new RejectedError('The action failed.');
      }),
    );
    const { code } = await run(app, ['get']);
    expect(code).toBe(65);
    expect([...lines, opened.region?.closedBy]).toEqual(['close failure', 'failure']);
  });

  it('calls close in place of the protocol, and asyncDispose before dispose', async () => {
    const lines = journal();
    const both = {
      [Symbol.asyncDispose]: async () => {
        lines.push('asyncDispose');
      },
      [Symbol.dispose]: () => {
        lines.push('dispose');
      },
    };
    const declared: Provider<'declared', typeof both> = provider('declared', {
      close: () => {
        lines.push('close');
      },
      load: async () => ({ default: () => both }),
    });
    const protocol: Provider<'protocol', typeof both> = provider('protocol', {
      load: async () => ({ default: () => both }),
    });
    const sync: Provider<'sync', { [Symbol.dispose]: () => void }> = provider('sync', {
      load: async () => ({
        default: () => ({
          [Symbol.dispose]: () => {
            lines.push('sync dispose');
          },
        }),
      }),
    });
    const plain: Provider<'plain', number> = provider('plain', {
      load: async () => ({ default: () => 1 }),
    });
    const app = new Application('app').command(
      new Command('get', { uses: [sync, protocol, declared, plain] }).action(() => undefined),
    );
    const { code } = await run(app, ['get']);
    expect(code).toBe(0);
    expect(lines).toEqual(['close', 'asyncDispose', 'sync dispose']);
  });
});

describe('failures', () => {
  it('closes what was built when an opener throws, and never runs the action', async () => {
    const lines = journal();
    const built = recorded(lines, 'built');
    const broken: Provider<'broken', string> = provider('broken', {
      load: async () => ({
        default: () => {
          throw new UnavailableError('The database refused the connection.');
        },
      }),
    });
    const never = recorded(lines, 'never');
    const app = new Application('app').command(
      new Command('get', { uses: [built, broken, never] }).action(() => {
        lines.push('action');
      }),
    );
    const { code, stderr } = await run(app, ['get']);
    expect(code).toBe(69);
    expect(stderr).toContain('The database refused the connection.');
    expect(lines).toEqual(['open built', 'close built']);
  });

  it('offers a throwing load to the translators', async () => {
    class RefusedError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'RefusedError';
      }
    }
    const broken: Provider<'broken', string> = provider('broken', {
      load: () => Promise.reject(new RefusedError('refused')),
    });
    const app = new Application('app', {
      translators: [
        translate(RefusedError, () => new BrokenError('The provider module could not load.')),
      ],
    }).command(new Command('get', { uses: [broken] }).action(() => undefined));
    const { code, stderr } = await run(app, ['get']);
    expect(code).toBe(70);
    expect(stderr).toContain('The provider module could not load.');
  });

  it('fails a run that had succeeded with the first close that throws, and logs the later ones', async () => {
    const events: LogEvent[] = [];
    const first = throwing('first', 'The first close failed.');
    const second = throwing('second', 'The second close failed.');
    const app = new Application('app', { plugins: [collecting(events)] }).command(
      new Command('get', { uses: [first, second] }).action(() => undefined),
    );
    const { code, stderr } = await run(app, ['get']);
    expect(code).toBe(75);
    expect(stderr).toContain('The second close failed.');
    expect(stderr).not.toContain('The first close failed.');
    const closes = events.filter(({ message }) => message === "A provider's close failed.");
    expect(closes.map(({ fields, level }) => [level, fields.provider])).toEqual([
      ['error', 'first'],
    ]);
  });

  it('logs a close that throws on a run that already failed', async () => {
    const events: LogEvent[] = [];
    const thrown = new Error('socket gone');
    const failing: Provider<'failing', string> = provider('failing', {
      close: () => {
        throw thrown;
      },
      load: async () => ({ default: () => 'value' }),
    });
    const app = new Application('app', { plugins: [collecting(events)] }).command(
      new Command('get', { uses: [failing] }).action(() => {
        throw new RejectedError('The action failed.');
      }),
    );
    const { code, stderr } = await run(app, ['get']);
    expect(code).toBe(65);
    expect(stderr).toContain('The action failed.');
    const closes = events.filter(({ message }) => message === "A provider's close failed.");
    expect(closes.map(({ fields }) => [fields.error, fields.provider])).toEqual([
      [expect.objectContaining({ message: 'socket gone' }), 'failing'],
    ]);
  });
});

describe('cancellation', () => {
  it('lets the opener in flight settle, builds nothing further, closes what was built, and skips the action', async () => {
    const lines = journal();
    const controller = new AbortController();
    const built = recorded(lines, 'built');
    const slow: Provider<'slow', { name: string }> = provider('slow', {
      load: async () => ({
        default: async () => {
          lines.push('open slow');
          controller.abort();
          await Promise.resolve();
          return disposable(lines, 'slow');
        },
      }),
    });
    const never = recorded(lines, 'never');
    const app = new Application('app').command(
      new Command('get', { uses: [built, slow, never] }).action(() => {
        lines.push('action');
      }),
    );
    const mock = mockProcess({ argv: ['get'] });
    await expect(app.run({ process: mock, signal: controller.signal })).resolves.toBe(130);
    expect(mock.stderr.text).toBe('');
    expect(lines).toEqual(['open built', 'open slow', 'close slow', 'close built']);
  });

  it("is silent for an opener that rejects with the signal's reason and reports any other rejection", async () => {
    const outcomes: string[] = [];
    for (const echo of [true, false]) {
      const controller = new AbortController();
      const slow: Provider<'slow', string> = provider('slow', {
        load: async () => ({
          default: ({ signal }) => {
            controller.abort();
            throw echo ? signal.reason : new Error('The handshake broke.');
          },
        }),
      });
      const app = new Application('app').command(
        new Command('get', { uses: [slow] }).action(() => undefined),
      );
      const mock = mockProcess({ argv: ['get'] });
      const code = await app.run({ process: mock, signal: controller.signal });
      outcomes.push(`${code} ${mock.stderr.text.includes('The handshake broke.')}`);
    }
    expect(outcomes).toEqual(['130 false', '130 true']);
  });
});

describe('a shutdown', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('cuts off a close still running when the budget runs out', async () => {
    const reached = Promise.withResolvers<void>();
    const hanging: Provider<'hanging', string> = provider('hanging', {
      close: () => {
        reached.resolve();
        return new Promise<void>(() => undefined);
      },
      load: async () => ({ default: () => 'value' }),
    });
    const mock = mockProcess({ argv: ['get'] });
    const app = new Application('app', { shutdown: { timeout: 50 } }).command(
      new Command('get', { uses: [hanging] }).action(() => undefined),
    );
    void app.run({ process: mock });
    await reached.promise;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
    mock.signals.raise('SIGINT');
    vi.advanceTimersByTime(49);
    expect(mock.endedBy).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(mock.endedBy).toBe('SIGINT');
  });
});
