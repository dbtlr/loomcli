import { Writable } from 'node:stream';

import { Application, Command, extension, FatalError, InternalError, plugin } from '@loomcli/core';
import { z } from 'zod';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    const [scenario, ...argv] = fixtureWords;

    /** The caller's own controller, which a cancelling scenario aborts from its action. */
    const controller = new AbortController();

    /** Every event a collecting `onLog` received, with whether core froze it whole. */
    const collected = [];

    /** Whether a value and everything it holds is frozen. */

    /** The hook every collecting plugin installs: it keeps the event as received. */
    function record(event) {
      collected.push({ event, frozen: deepFrozen(event) });
    }

    const collector = plugin('fixture/collector', { onLog: record });

    /** A plugin that installs no `onLog`, so core creates no event for a call. */
    const silent = plugin('fixture/silent', {});

    /** A stdout on a full disk, so every write fails, which leaves a broken destination. */

    /** The key a source binds, so the source below is asked about an option that carries it. */
    const key = extension('@fixture/logging/key', { schema: z.string(), target: 'option' });

    /** A plugin that logs from its middleware, its source, and its `onFailure` hook, and collects. */
    const reaching = plugin('fixture/reaching', {
      extensions: [key],
      middleware: {
        activate: 'always',
        load: async () => ({
          default: async ({ log, next }) => {
            log.info('from middleware');
            await next();
          },
        }),
      },
      onFailure: (_failure, { log }) => {
        log.info('from hook');
        return undefined;
      },
      onLog: record,
      source: {
        binding: key,
        load: async () => ({
          default: async ({ log }) => {
            log.info('from source');
            return {};
          },
        }),
      },
    });

    /** A group with one child, so a path reads empty, partial, and routed. */

    class Point {
      across = 1;
      down = 2;

      length() {
        return 3;
      }
    }

    /** The fields the copy scenario logs, one value of each kind the copy rule names. */
    function copiedFields() {
      const loop = { name: 'loop' };
      loop.self = loop;
      const shared = { value: 1 };
      return {
        array: [undefined, Number.NaN, () => 1, Symbol('s'), 'kept'],
        bigint: 10n,
        circular: loop,
        date: new Date(0),
        error: new Error('outer', { cause: new TypeError('inner') }),
        fn: () => 1,
        infinite: Number.POSITIVE_INFINITY,
        instance: new Point(),
        json: { toJSON: () => ({ replaced: true }) },
        map: new Map([['key', 1]]),
        nested: { value: 1 },
        nothing: undefined,
        shared: [shared, shared],
        symbol: Symbol('s'),
      };
    }

    /** An application whose action fails with an input error, a fatal, or a defect, by scenario. */

    /** A view that throws, which a render the action never awaited fails through after the action. */
    const breaking = {
      render: () => {
        throw new Error('The view broke.');
      },
    };

    /** Extra lines a scenario prints beside the events, keyed for the test to read. */
    const printed = [];

    const scenarios = {
      'after-primary': () =>
        failing([collector], ({ out }) => {
          void out.render('late', breaking);
          out.fatal('The action failed.');
        }),
      // A call from an action returns undefined and a collector receives a frozen event.
      basic: () =>
        failing([collector], ({ log }) => {
          printed.push({ returned: log.info('hello', { count: 1 }) });
        }),
      'build-fault': () =>
        new Application('probe', { description: 'Probe a build fault.', plugins: [collector] }),
      // The caller cancels, then the action fails with its own failure, which still renders.
      'cancelled-rendered': () =>
        failing([collector], () => {
          controller.abort(new Error('the caller stopped the run'));
          throw new FatalError('The action failed.');
        }),
      // The caller cancels, and the action rejects with the signal's reason, which reports nothing.
      'cancelled-silent': () =>
        failing([collector], ({ signal }) => {
          controller.abort(new Error('the caller stopped the run'));
          throw signal.reason;
        }),
      // A caller's later change to the object leaves the event unchanged.
      changed: () =>
        failing([collector], ({ log }) => {
          const fields = { count: 1, nested: { value: 1 } };
          log.info('first', fields);
          fields.count = 2;
          fields.nested.value = 2;
        }),
      copy: () =>
        failing([collector], ({ log }) => {
          log.info('copied', copiedFields());
        }),
      // Destructured methods keep working.
      detached: () =>
        failing([collector], ({ log }) => {
          const { info } = log;
          info('detached');
        }),
      'empty-fields': () =>
        failing([collector], ({ log }) => {
          log.info('none');
        }),
      // An action fails by throwing a class core logs at `error`.
      'input-error': () => failing([collector], dispatch),
      'internal-error': () =>
        failing([collector], () => {
          throw new InternalError('The action reported a defect.', undefined);
        }),
      'invoke-failure': () =>
        new Application('probe', { description: 'Probe a nested failure.', plugins: [collector] })
          .command(
            new Command('inner', { description: 'The inner command.' }).action(({ out }) =>
              out.fatal('The inner failed.'),
            ),
          )
          .action(async ({ invoke, log }) => {
            const outcome = await invoke(['inner'], {});
            log.info('after inner');
            printed.push({ inner: outcome.status });
          }),
      // Every level, in call order.
      levels: () =>
        failing([collector], ({ log }) => {
          log.trace('trace message');
          log.debug('debug message');
          log.info('info message');
          log.warn('warn message');
          log.error('error message');
          printed.push({ fatal: typeof log.fatal });
        }),
      // The negative control of `unlogged`: with a collector, the getter is read.
      listened: () =>
        failing([collector], ({ log }) => {
          let reads = 0;
          log.info('read', {
            get counted() {
              reads += 1;
              return reads;
            },
          });
          printed.push({ reads });
        }),
      'path-routed': () => grouped({ plugins: [collector] }),
      reach: () =>
        new Application('probe', {
          description: 'Probe the reach of log.',
          plugins: [
            reaching,
            plugin('fixture/commands', {
              commands: [
                new Command('plug', { description: 'The plugin command.' }).action(({ log }) => {
                  log.info('from plugin command');
                }),
              ],
            }),
          ],
        })
          .globalOption('limit', { extensions: [key('limit')], type: 'string' })
          .action(({ log, out }) => {
            log.info('from action');
            out.fatal('The action failed.');
          }),
      // The root logs, calls the nested Command, and logs again; app.invoke runs after the run.
      runs: () =>
        new Application('probe', { description: 'Probe run identity.', plugins: [collector] })
          .command(
            new Command('inner', { description: 'The inner command.' }).action(({ log }) =>
              log.info('inner'),
            ),
          )
          .action(async ({ invoke, log }) => {
            log.info('outer');
            await invoke(['inner'], {});
            log.info('outer again');
          }),
      'stdout-broken': () =>
        new Application('probe', {
          description: 'Probe a full disk.',
          plugins: [collector],
        }).action(({ out }) => out.print('lost')),
      'stdout-broken-after-failure': () =>
        new Application('probe', {
          description: 'Probe a full disk.',
          plugins: [collector],
        }).action(async ({ out }) => {
          // The action catches the failed write and fails on its own.
          // A run whose output failed reports only the destination.
          await out.print('lost').catch(() => undefined);
          throw new FatalError('The action failed.');
        }),
      'throw-string': () =>
        failing([collector], () => {
          throw 'boom';
        }),
      'type-error': () =>
        failing([collector], () => {
          throw new TypeError('The probe failed.');
        }),
      // The action reads whether a getter on its fields is read with no listener installed.
      unlogged: () =>
        failing([silent], ({ log }) => {
          let reads = 0;
          const returned = log.info('unread', {
            get counted() {
              reads += 1;
              return reads;
            },
          });
          printed.push({ reads, returned: returned === undefined });
        }),
      unversioned: () =>
        new Application('probe', {
          description: 'Probe the version.',
          plugins: [collector],
        }).action(({ log }) => log.info('unversioned')),
      version: () =>
        new Application('probe', {
          description: 'Probe the version.',
          plugins: [collector],
          version: '1.2.3',
        }).action(({ log }) => log.info('versioned')),
    };

    const build = scenarios[scenario];
    if (build === undefined) {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
    const app = build();
    /** The build a test names, or the facts a bundle bakes in when none is named. */
    const release =
      fixtureEnv.FIXTURE_BUILD === undefined
        ? {}
        : { release: { build: fixtureEnv.FIXTURE_BUILD } };
    /** A stdout that fails every write, for the scenarios whose destination breaks. */
    const stdout = scenario.startsWith('stdout-broken') ? { stdout: fullDisk() } : {};
    const code = await app.run({
      process: createProcess({ argv, ...release, ...stdout }),
      signal: controller.signal,
    });
    if (scenario === 'runs') {
      collected.push({ marker: 'invoke' });
      await app.invoke(['inner'], {}, { process: createProcess() });
    }
    for (const entry of collected) {
      writeStdout(`event:${JSON.stringify(entry)}\n`);
    }
    for (const entry of printed) {
      writeStdout(`print:${JSON.stringify(entry)}\n`);
    }
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function deepFrozen(value) {
  if (value === null || typeof value !== 'object') {
    return true;
  }
  return Object.isFrozen(value) && Object.values(value).every(deepFrozen);
}
const dispatch = ({ out }) => out.print('dispatched');
function fullDisk() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' }));
    },
  });
}
function grouped(options = {}) {
  const clear = new Command('clear', { description: 'The clear command.' }).action(({ log }) => {
    log.info('routed');
  });
  return new Application('store', { description: 'Store values.', ...options })
    .globalOption('file', { description: 'The file option.', type: 'string' })
    .command(new Command('cache', { description: 'The cache command.' }).command(clear));
}
function failing(plugins, action) {
  return new Application('probe', { description: 'Probe a failure.', plugins }).action(action);
}

export { runFixture as run };
