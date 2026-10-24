/**
 * The shutdown an ending signal starts, under docs/core/signals.md and ADR-0106, proven in the
 * test's own process through a mock's signal source. Every case raises its signal on a mock, so
 * nothing reaches the process the tests run in.
 *
 * - Listening. A `run()` listens on its handle's signal source from the moment it is called, for
 *   SIGINT, SIGTERM, SIGHUP, SIGQUIT, and the exit event, and holds nothing before or after. An
 *   `app.invoke` never starts listening.
 * - The shutdown. An ending signal aborts every live run with its name as the source. It ends at
 *   the first of every run resolved, then the next turn; the budget, `shutdown.timeout`, 500 by
 *   default and the longest among the runs live at the first signal; or a second ending signal.
 *   SIGQUIT skips the budget. A run started during it starts cancelled and extends nothing. At the
 *   end each queued region frame reaches the terminal and the cursor shows, every pending handler
 *   runs once, newest first, and the first signal is re-raised on the source, which ends the mock.
 * - onShutdown. A run's handler goes with its run when no shutdown is under way, and stays pending
 *   through one; a handler registered after its run is never called; a remover removes; a throw is
 *   caught and logged naming the plugin; `app.invoke` handlers run at a shutdown under way.
 * - The lane. Two copies of core resolve one real lane and one lane per mock, and the real lane's
 *   members are pinned. A mock's shutdown never touches the real process.
 * - shutdown.timeout. Only a whole number from 0 through 2147483647 is accepted.
 * - Suspend and resume. On SIGTSTP the suspend handlers run newest first and SIGTSTP is re-raised
 *   with core's listener gone; on the SIGCONT that follows core listens again and the resume
 *   handlers run in registration order.
 */
import { mockProcess } from '@loomcli/testing';
import type { MockProcess } from '@loomcli/testing';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

import {
  Application,
  Command,
  DeclarationError,
  onShutdown,
  plugin,
  processHandle,
} from '../src/index.js';
import type { Middleware, Plugin, ShutdownEvent } from '../src/index.js';
import { laneOf } from '../src/process-handle.js';

afterEach(() => {
  vi.useRealTimers();
});

/** The events a lane listens for, in the order a count reads them. */
const events = ['SIGINT', 'SIGTERM', 'SIGHUP', 'SIGQUIT', 'exit', 'SIGTSTP', 'SIGCONT'] as const;

/** Counts the listeners core holds on one mock's source, per event, from every `on` and `off`. */
function listening(mock: MockProcess): () => string {
  const on = vi.spyOn(mock.signals, 'on');
  const off = vi.spyOn(mock.signals, 'off');
  return () =>
    events
      .map(
        (event) =>
          on.mock.calls.filter(([name]) => name === event).length -
          off.mock.calls.filter(([name]) => name === event).length,
      )
      .join(',');
}

/** Waits for the event loop to turn once, past the phase that runs `setImmediate` callbacks. */
function nextTurn(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/** A promise and the call that resolves it. */
function deferred(): { promise: Promise<void>; resolve: () => void } {
  const { promise, resolve } = Promise.withResolvers<void>();
  return { promise, resolve: () => resolve() };
}

/** A middleware that registers a handler writing its event to `lines`, then continues the chain. */
function registering(lines: string[]): Middleware<Plugin> {
  return async ({ next, onShutdown: register }) => {
    register((event) => {
      lines.push(described('middleware', event));
    });
    await next();
  };
}

/** A middleware whose handler throws, then continues the chain. */
const throwing: Middleware<Plugin> = async ({ next, onShutdown: register }) => {
  register(() => {
    throw new Error('the middleware handler broke');
  });
  await next();
};

/** Resolves once `signal` aborts. */
function aborted(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => {
      resolve();
    });
  });
}

/** A promise that never settles, as an action that ignores its signal awaits. */
function forever(): Promise<never> {
  return new Promise(() => undefined);
}

/** The source a run's signal aborted with, or `none`. */
function sourceOf(signal: AbortSignal): string {
  const reason: unknown = signal.reason;
  const source: unknown =
    typeof reason === 'object' && reason !== null ? Reflect.get(reason, 'source') : undefined;
  return typeof source === 'string' ? source : 'none';
}

/** The text of one shutdown event, as the order tests record it. */
function described(label: string, event: ShutdownEvent): string {
  return `${label}:${event.cause}:${String(event.code)}`;
}

describe('listening', () => {
  it('a run listens from the moment run() is called and holds nothing before or after', async () => {
    const mock = mockProcess();
    const count = listening(mock);
    const counts: string[] = [count()];
    const app = new Application('app').action(() => {
      counts.push(count());
    });
    const running = app.run({ process: mock });
    counts.push(count());
    await running;
    counts.push(count());
    expect(counts).toEqual(['0,0,0,0,0,0,0', '1,1,1,1,1,0,0', '1,1,1,1,1,0,0', '0,0,0,0,0,0,0']);
  });

  it.each([
    ['an unknown command', ['nope'], () => undefined, 2],
    [
      'a thrown failure',
      [],
      () => {
        throw new Error('the action broke');
      },
      1,
    ],
    [
      'the action cancelling',
      [],
      ({ cancel }: { cancel: () => void }) => {
        cancel();
      },
      130,
    ],
    ['an unknown option', ['--nope'], () => undefined, 2],
  ] as const)(
    'a run that ends with %s holds no listener after',
    async (_case, argv, action, code) => {
      const mock = mockProcess({ argv: [...argv] });
      const count = listening(mock);
      const app = new Application('app').action(action);
      await expect(app.run({ process: mock })).resolves.toBe(code);
      expect(count()).toBe('0,0,0,0,0,0,0');
    },
  );

  it('a run whose caller signal aborted at entry holds no listener after', async () => {
    const mock = mockProcess();
    const count = listening(mock);
    const app = new Application('app').action(() => undefined);
    await expect(app.run({ process: mock, signal: AbortSignal.abort() })).resolves.toBe(130);
    expect(count()).toBe('0,0,0,0,0,0,0');
  });

  it('a signal raised right after run() is called reaches the run', async () => {
    const mock = mockProcess();
    const ran: string[] = [];
    const app = new Application('app').action(() => {
      ran.push('action');
    });
    const running = app.run({ process: mock });
    mock.signals.raise('SIGINT');
    await expect(running).resolves.toBe(130);
    expect([ran, mock.exitCode, mock.endedBy]).toEqual([[], 130, undefined]);
    await nextTurn();
    expect(mock.endedBy).toBe('SIGINT');
  });

  it('app.invoke never starts listening, so a signal with no run() ends the mock at once', async () => {
    const mock = mockProcess();
    const count = listening(mock);
    const during: string[] = [];
    const app = new Application('app').action(({ onShutdown: register }) => {
      register(() => undefined);
      during.push(count());
    });
    const outcome = await app.invoke([], {}, { process: mock });
    expect([outcome.status, during, count()]).toEqual([
      'completed',
      ['0,0,0,0,0,0,0'],
      '0,0,0,0,0,0,0',
    ]);
    mock.signals.raise('SIGTERM');
    expect(mock.endedBy).toBe('SIGTERM');
  });
});

describe('the shutdown', () => {
  it('SIGTERM aborts the run with its name, the run unwinds, resolves 143, and the mock ends on the next turn', async () => {
    const mock = mockProcess();
    const lines: string[] = [];
    const watching: Middleware<Plugin> = async ({ next }) => {
      try {
        await next();
      } finally {
        lines.push('middleware:finally');
      }
    };
    const app = new Application('app', {
      plugins: [
        plugin('@fixture/watching', {
          middleware: { activate: 'always', load: async () => ({ default: watching }) },
        }),
      ],
    }).action(async ({ signal }) => {
      const wait = aborted(signal);
      mock.signals.raise('SIGTERM');
      await wait;
      lines.push(`action:${sourceOf(signal)}`);
    });
    const code = await app.run({ process: mock });
    lines.push(`resolved:${String(code)}:${String(mock.endedBy)}`);
    await nextTurn();
    expect([...lines, String(mock.endedBy), String(mock.exitCode)]).toEqual([
      'action:SIGTERM',
      'middleware:finally',
      'resolved:143:undefined',
      'SIGTERM',
      '143',
    ]);
  });

  it.each([
    ['SIGHUP', 129],
    ['SIGINT', 130],
    ['SIGTERM', 143],
  ] as const)(
    'a run %s cancels resolves %i and writes it to its handle',
    async (signal, status) => {
      const mock = mockProcess();
      const app = new Application('app').action(async ({ signal: run }) => {
        const wait = aborted(run);
        mock.signals.raise(signal);
        await wait;
      });
      await expect(app.run({ process: mock })).resolves.toBe(status);
      expect(mock.exitCode).toBe(status);
    },
  );

  it('an action that ignores its signal ends at the budget, 500 milliseconds by default', async () => {
    const mock = mockProcess();
    const reached = deferred();
    const called: string[] = [];
    const app = new Application('app').action(async ({ onShutdown: register }) => {
      register((event) => {
        called.push(described('handler', event));
      });
      reached.resolve();
      await forever();
    });
    void app.run({ process: mock });
    await reached.promise;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
    mock.signals.raise('SIGINT');
    vi.advanceTimersByTime(499);
    expect([mock.endedBy, called]).toEqual([undefined, []]);
    vi.advanceTimersByTime(1);
    expect([mock.endedBy, called]).toEqual(['SIGINT', ['handler:SIGINT:130']]);
  });

  it('the budget is the longest shutdown.timeout among the runs live at the first signal', async () => {
    const mock = mockProcess();
    const reached = [deferred(), deferred()];
    const hanging = (timeout: number, index: number) =>
      new Application('app', { shutdown: { timeout } }).action(async () => {
        reached[index]?.resolve();
        await forever();
      });
    void hanging(100, 0).run({ process: mock });
    void hanging(300, 1).run({ process: mock });
    await Promise.all(reached.map(({ promise }) => promise));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
    mock.signals.raise('SIGTERM');
    vi.advanceTimersByTime(299);
    expect(mock.endedBy).toBeUndefined();
    vi.advanceTimersByTime(1);
    expect(mock.endedBy).toBe('SIGTERM');
  });

  it('a timeout of 0 ends the shutdown at once, within the raise', async () => {
    const mock = mockProcess();
    const reached = deferred();
    const app = new Application('app', { shutdown: { timeout: 0 } }).action(async () => {
      reached.resolve();
      await forever();
    });
    void app.run({ process: mock });
    await reached.promise;
    mock.signals.raise('SIGHUP');
    expect(mock.endedBy).toBe('SIGHUP');
  });

  it('a run started during the shutdown starts cancelled and does not extend the budget', async () => {
    const mock = mockProcess();
    const reached = deferred();
    const first = new Application('app', { shutdown: { timeout: 100 } }).action(async () => {
      reached.resolve();
      await forever();
    });
    void first.run({ process: mock });
    await reached.promise;
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'clearImmediate'] });
    mock.signals.raise('SIGINT');
    const sources: string[] = [];
    const late = new Application('app', { shutdown: { timeout: 1000 } }).action(
      async ({ signal }) => {
        sources.push(sourceOf(signal));
        await forever();
      },
    );
    const lateRun = late.run({ process: mock });
    vi.advanceTimersByTime(100);
    expect(mock.endedBy).toBe('SIGINT');
    vi.useRealTimers();
    // The late run was cancelled at its entry, so it never reached its action.
    await expect(lateRun).resolves.toBe(130);
    expect(sources).toEqual([]);
  });

  it('a run cut off by a shutdown keeps no listener, and a later run makes core listen again', async () => {
    const mock = mockProcess();
    const count = listening(mock);
    const reached = deferred();
    const kept: { register?: (handler: () => void) => () => void } = {};
    const hung = new Application('app', { shutdown: { timeout: 0 } }).action(
      async ({ onShutdown: register }) => {
        kept.register = register;
        reached.resolve();
        await forever();
      },
    );
    void hung.run({ process: mock });
    await reached.promise;
    mock.signals.raise('SIGINT');
    const counts = [count()];
    // The cut-off run is still running, and a handler it registers now starts nothing listening.
    kept.register?.(() => undefined);
    counts.push(count());
    const later = new Application('app').action(() => {
      counts.push(count());
    });
    await later.run({ process: mock });
    counts.push(count());
    expect([mock.endedBy, counts]).toEqual([
      'SIGINT',
      ['0,0,0,0,0,0,0', '0,0,0,0,0,0,0', '1,1,1,1,1,0,0', '0,0,0,0,0,0,0'],
    ]);
  });

  it('a second ending signal ends the shutdown at once and re-raises the first', async () => {
    const mock = mockProcess();
    const reached = deferred();
    const called: string[] = [];
    const app = new Application('app').action(async ({ onShutdown: register }) => {
      register((event) => {
        called.push(described('handler', event));
      });
      reached.resolve();
      await forever();
    });
    void app.run({ process: mock });
    await reached.promise;
    mock.signals.raise('SIGINT');
    expect(mock.endedBy).toBeUndefined();
    mock.signals.raise('SIGTERM');
    expect([mock.endedBy, called]).toEqual(['SIGINT', ['handler:SIGINT:130']]);
  });

  it('SIGQUIT skips the budget: it cancels, calls the handlers, and re-raises at once', async () => {
    const mock = mockProcess();
    const reached = deferred();
    const lines: string[] = [];
    const app = new Application('app', { shutdown: { timeout: 2000 } }).action(
      async ({ onShutdown: register, signal }) => {
        signal.addEventListener('abort', () => {
          lines.push(`aborted:${sourceOf(signal)}`);
        });
        register((event) => {
          lines.push(described('handler', event));
        });
        reached.resolve();
        await forever();
      },
    );
    void app.run({ process: mock });
    await reached.promise;
    mock.signals.raise('SIGQUIT');
    expect([mock.endedBy, lines]).toEqual(['SIGQUIT', ['aborted:SIGQUIT', 'handler:SIGQUIT:131']]);
  });

  it('a SIGQUIT during a shutdown ends it by SIGQUIT', async () => {
    const mock = mockProcess();
    const reached = deferred();
    const called: string[] = [];
    const app = new Application('app').action(async ({ onShutdown: register }) => {
      register((event) => {
        called.push(described('handler', event));
      });
      reached.resolve();
      await forever();
    });
    void app.run({ process: mock });
    await reached.promise;
    mock.signals.raise('SIGTERM');
    mock.signals.raise('SIGQUIT');
    expect([mock.endedBy, called]).toEqual(['SIGQUIT', ['handler:SIGQUIT:131']]);
  });

  it("a run an abort listener starts during the shutdown's first calls joins it cancelled", async () => {
    const mock = mockProcess();
    const reached = deferred();
    const sources: string[] = [];
    let started: Promise<number> | undefined = undefined;
    const second = new Application('app').action(() => {
      sources.push('second:action');
    });
    const first = new Application('app').action(async ({ signal }) => {
      signal.addEventListener('abort', () => {
        started = second.run({ process: mock });
      });
      reached.resolve();
      await aborted(signal);
    });
    const firstRun = first.run({ process: mock });
    await reached.promise;
    mock.signals.raise('SIGINT');
    await expect(firstRun).resolves.toBe(130);
    await expect(started).resolves.toBe(130);
    expect(sources).toEqual([]);
    await nextTurn();
    expect(mock.endedBy).toBe('SIGINT');
  });

  it('a shutdown aborts a live app.invoke, which resolves cancelled with the signal code', async () => {
    const mock = mockProcess();
    const reached = deferred();
    const holder = new Application('holder').action(async ({ signal }) => {
      await aborted(signal);
    });
    const called: string[] = [];
    const invoked = new Application('invoked').action(async ({ onShutdown: register, signal }) => {
      register((event) => {
        called.push(described('invoked', event));
      });
      reached.resolve();
      await aborted(signal);
    });
    const holding = holder.run({ process: mock });
    const call = invoked.invoke([], {}, { process: mock });
    await reached.promise;
    mock.signals.raise('SIGHUP');
    await expect(call).resolves.toEqual({ exitCode: 129, status: 'cancelled' });
    await expect(holding).resolves.toBe(129);
    await nextTurn();
    expect([mock.endedBy, called]).toEqual(['SIGHUP', ['invoked:SIGHUP:129']]);
  });

  it("an action's own call is cancelled with its run's signal code", async () => {
    const mock = mockProcess({ argv: ['parent'] });
    const outcomes: unknown[] = [];
    const app = new Application('app')
      .command(
        new Command('child').action(async ({ signal }) => {
          const wait = aborted(signal);
          mock.signals.raise('SIGTERM');
          await wait;
        }),
      )
      .command(
        new Command('parent').action(async ({ invoke }) => {
          outcomes.push(await invoke(['child'], {}));
        }),
      );
    await expect(app.run({ process: mock })).resolves.toBe(143);
    expect(outcomes).toEqual([{ exitCode: 143, status: 'cancelled' }]);
  });
});

describe('the end of a shutdown', () => {
  it("a region's cancelled line reaches the terminal at a budget of 0, and the cursor shows", async () => {
    const mock = mockProcess({ terminal: { columns: 80, rows: 24 } });
    const reached = deferred();
    const view = { render: (text: string) => text };
    const app = new Application('app', { shutdown: { timeout: 0 } }).action(async ({ out }) => {
      const region = out.region();
      region.signal.addEventListener('abort', () => {
        void region.draw('CANCELLED-LINE', view);
      });
      await region.draw('WORKING-FRAME', view);
      reached.resolve();
      await forever();
    });
    void app.run({ process: mock });
    await reached.promise;
    mock.signals.raise('SIGTERM');
    expect(mock.endedBy).toBe('SIGTERM');
    expect(mock.stderr.text).toContain('CANCELLED-LINE');
    expect(mock.stderr.text.endsWith('\u001B[?25h')).toBe(true);
  });

  it('every pending handler runs once, newest first, from the action and its middleware', async () => {
    const mock = mockProcess();
    const lines: string[] = [];
    const app = new Application('app', {
      plugins: [
        plugin('@fixture/registering', {
          middleware: {
            activate: 'always',
            load: async () => ({ default: registering(lines) }),
          },
        }),
      ],
    }).action(async ({ onShutdown: register, signal }) => {
      register((event) => {
        lines.push(described('first', event));
      });
      register((event) => {
        lines.push(described('second', event));
      });
      const wait = aborted(signal);
      mock.signals.raise('SIGINT');
      await wait;
      lines.push('unwound');
    });
    await app.run({ process: mock });
    await nextTurn();
    // A second signal after the end finds nothing listening, and no handler runs twice.
    mock.signals.raise('SIGINT');
    expect(lines).toEqual([
      'unwound',
      'second:SIGINT:130',
      'first:SIGINT:130',
      'middleware:SIGINT:130',
    ]);
  });

  it('a throwing handler is caught, logged naming its plugin, and the rest still run', async () => {
    const mock = mockProcess();
    const lines: string[] = [];
    const app = new Application('app', {
      plugins: [
        plugin('@fixture/registering', {
          middleware: { activate: 'always', load: async () => ({ default: throwing }) },
          onLog: (event) => {
            const error: unknown = event.fields.error;
            lines.push(
              `log:${event.level}:${event.message}:${String(event.plugin)}:${JSON.stringify(error)}`,
            );
          },
        }),
      ],
    }).action(async ({ onShutdown: register, signal }) => {
      register(() => {
        lines.push('older');
      });
      register(() => {
        throw new Error('the action handler broke');
      });
      const wait = aborted(signal);
      mock.signals.raise('SIGINT');
      await wait;
    });
    await app.run({ process: mock });
    await nextTurn();
    expect(lines.map((line) => line.replace(/:\{.*\}$/u, ':{…}'))).toEqual([
      'log:error:A shutdown handler failed.:null:{…}',
      'older',
      'log:error:A shutdown handler failed.:@fixture/registering:{…}',
    ]);
    expect(mock.endedBy).toBe('SIGINT');
  });

  it("a run's handler goes with its run when no shutdown is under way", async () => {
    const mock = mockProcess();
    const count = listening(mock);
    const called: string[] = [];
    const kept: { register?: (handler: () => void) => () => void } = {};
    const app = new Application('app').action(({ onShutdown: onEnd }) => {
      onEnd(() => {
        called.push('during');
      });
      kept.register = onEnd;
    });
    await app.run({ process: mock });
    // A handler registered after its run ended is never called, and starts nothing listening.
    kept.register?.(() => {
      called.push('after');
    });
    expect(count()).toBe('0,0,0,0,0,0,0');
    mock.signals.raise('SIGINT');
    expect([mock.endedBy, called]).toEqual(['SIGINT', []]);
  });

  it('a removed handler is not called at the end', async () => {
    const mock = mockProcess();
    const called: string[] = [];
    const app = new Application('app').action(async ({ onShutdown: register, signal }) => {
      const remove = register(() => {
        called.push('removed');
      });
      register(() => {
        called.push('kept');
      });
      remove();
      const wait = aborted(signal);
      mock.signals.raise('SIGTERM');
      await wait;
    });
    await app.run({ process: mock });
    await nextTurn();
    expect(called).toEqual(['kept']);
  });
});

describe('the lane', () => {
  it('a mock shutdown never touches the real process', async () => {
    const before = events.map((event) => process.listenerCount(event));
    const exitCode = process.exitCode;
    const mock = mockProcess();
    const during: number[][] = [];
    const app = new Application('app').action(async ({ signal }) => {
      during.push(events.map((event) => process.listenerCount(event)));
      const wait = aborted(signal);
      mock.signals.raise('SIGINT');
      await wait;
    });
    await expect(app.run({ process: mock })).resolves.toBe(130);
    await nextTurn();
    expect(mock.endedBy).toBe('SIGINT');
    expect([during, events.map((event) => process.listenerCount(event)), process.exitCode]).toEqual(
      [[before], before, exitCode],
    );
  });

  it('two copies of core resolve one real lane and one lane per mock, which listens once', async () => {
    const copy = await import('../dist/index.js');
    expect(copy.processHandle().signals).toBe(processHandle().signals);
    const mock = mockProcess();
    const count = listening(mock);
    const reached = [deferred(), deferred()];
    const counts: string[] = [];
    const ours = new Application('ours').action(async ({ signal }) => {
      reached[0]?.resolve();
      await aborted(signal);
    });
    const theirs = new copy.Application('theirs').action(async ({ signal }) => {
      reached[1]?.resolve();
      await aborted(signal);
    });
    const runs = [ours.run({ process: mock }), theirs.run({ process: mock })];
    await Promise.all(reached.map(({ promise }) => promise));
    counts.push(count());
    mock.signals.raise('SIGTERM');
    await expect(Promise.all(runs)).resolves.toEqual([143, 143]);
    await nextTurn();
    expect([counts, mock.endedBy, count()]).toEqual([
      ['1,1,1,1,1,0,0'],
      'SIGTERM',
      '0,0,0,0,0,0,0',
    ]);
  });

  it("the real lane's shared members are pinned", () => {
    processHandle();
    const lane: unknown = Reflect.get(globalThis, Symbol.for('loomcli.processLane'));
    const members = ['enter', 'onShutdown', 'onSuspend', 'onResume'].map(
      (member) =>
        typeof (lane === null || typeof lane !== 'object' ? undefined : Reflect.get(lane, member)),
    );
    expect(members).toEqual(['function', 'function', 'function', 'function']);
    expect(lane !== null && typeof lane === 'object' && Reflect.get(lane, 'source')).toBe(
      processHandle().signals,
    );
    expect(lane !== null && typeof lane === 'object' && Reflect.get(lane, 'lanes')).toBeInstanceOf(
      WeakMap,
    );
  });

  it('the exported onShutdown is scoped to the process and listens on the real process', () => {
    const before = process.listenerCount('SIGTERM');
    const remove = onShutdown(() => undefined);
    const during = process.listenerCount('SIGTERM');
    remove();
    expect([during - before, process.listenerCount('SIGTERM') - before]).toEqual([1, 0]);
  });
});

describe('shutdown.timeout', () => {
  it.each([-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
    'the constructor rejects %d',
    (timeout) => {
      const thrown = (() => {
        try {
          return new Application('app', { shutdown: { timeout } });
        } catch (error) {
          return error;
        }
      })();
      expect(thrown).toBeInstanceOf(DeclarationError);
      expect(thrown instanceof DeclarationError ? thrown.rule?.identity : undefined).toBe(
        '@loomcli/core/invalid-shutdown-timeout',
      );
    },
  );

  it('the fault names the value, the range, and the default', () => {
    const thrown = (() => {
      try {
        return new Application('app', { shutdown: { timeout: 1.5 } });
      } catch (error) {
        return error;
      }
    })();
    expect(
      thrown instanceof DeclarationError
        ? { correction: thrown.correction, sentence: thrown.sentence }
        : undefined,
    ).toEqual({
      correction:
        'Set shutdown.timeout to a whole number of milliseconds from 0 through 2147483647, or leave it out for 500.',
      sentence:
        'The Application declares shutdown timeout 1.5, which is not a whole number of milliseconds from 0 through 2147483647.',
    });
  });

  it.each([0, 1, 2_147_483_647])('the constructor accepts %d', (timeout) => {
    expect(() => new Application('app', { shutdown: { timeout } })).not.toThrow();
  });
});

describe('suspend and resume', () => {
  it('SIGTSTP calls suspend handlers newest first, re-raises with no listener, then resumes in order at once on a mock', () => {
    const mock = mockProcess();
    const count = listening(mock);
    const lane = laneOf(mock.signals);
    const lines: string[] = [];
    const deliver = mock.signals.raise.bind(mock.signals);
    // Each raise is recorded with the listeners held at that moment, then delivered.
    vi.spyOn(mock.signals, 'raise').mockImplementation((signal) => {
      lines.push(`raise:${signal}:${count()}`);
      deliver(signal);
    });
    const removers = ['first', 'second'].flatMap((label) => [
      lane.onSuspend({
        handler: () => {
          lines.push(`suspend:${label}`);
        },
      }),
      lane.onResume({
        handler: () => {
          lines.push(`resume:${label}:${count()}`);
        },
      }),
    ]);
    // A SIGCONT with no suspend before it calls none.
    mock.signals.raise('SIGCONT');
    // A mock's raise returns at once, so each suspend runs its resume handlers back to back.
    mock.signals.raise('SIGTSTP');
    mock.signals.raise('SIGTSTP');
    // The resume already ran, so a SIGCONT now calls none.
    mock.signals.raise('SIGCONT');
    for (const remove of removers) {
      remove();
    }
    const suspend = [
      'raise:SIGTSTP:0,0,0,0,0,1,1',
      'suspend:second',
      'suspend:first',
      'raise:SIGTSTP:0,0,0,0,0,0,1',
      'resume:first:0,0,0,0,0,1,1',
      'resume:second:0,0,0,0,0,1,1',
    ];
    expect([lines, count()]).toEqual([
      ['raise:SIGCONT:0,0,0,0,0,1,1', ...suspend, ...suspend, 'raise:SIGCONT:0,0,0,0,0,1,1'],
      '0,0,0,0,0,0,0',
    ]);
  });
});
