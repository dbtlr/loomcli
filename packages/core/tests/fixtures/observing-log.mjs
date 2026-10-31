import { Writable } from 'node:stream';

import { DeclarationError, Application, Command, plugin } from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;

  function declare(build) {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`thrown:${error.exitCode}: ${ruleText(error)}\n`);
      throw fixture.stopped;
    }
  }
  try {
    const [scenario, ...argv] = fixtureWords;

    /** The caller's own controller, which a cancelling scenario aborts from its action. */
    const controller = new AbortController();

    /** What the run's stderr received, which a hook writes to through `destination.stderr`. */
    const written = [];
    const stderr = new Writable({
      write(chunk, _encoding, callback) {
        written.push(String(chunk));
        callback();
      },
    });

    /** A stdout on a full disk, so every write fails, which leaves a broken destination. */

    /** Extra lines a scenario prints, keyed for the test to read. */
    const printed = [];

    /** The first event any `observing` hook received, which a later hook compares by identity. */
    const firstSeen = new Map();

    /** A plugin whose hook writes each message to the destination's stderr, tagged with its name. */
    function observing(identity, extra = {}) {
      return plugin(identity, {
        onLog: (event, destination) => {
          if (!firstSeen.has(event.message)) {
            firstSeen.set(event.message, event);
          }
          printed.push({
            destination: {
              env: destination.env.PROBE ?? null,
              platform: destination.platform,
              stderr: destination.stderr === null ? 'null' : 'stream',
            },
            message: event.message,
            plugin: identity,
            same: firstSeen.get(event.message) === event,
          });
          destination.stderr?.write(`${identity}:${event.message}\n`);
        },
        ...extra,
      });
    }

    /** A hook that throws, on every event or on the level `only` names, counting every call it receives. */
    const calls = { broken: 0 };
    function breaking(only) {
      return plugin('fixture/broken', {
        onLog: (event) => {
          if (only !== undefined && event.level !== only) {
            return undefined;
          }
          calls.broken += 1;
          throw new TypeError('Cannot observe.');
        },
      });
    }

    /** A working hook that keeps its messages, so a test reads that it received every event. */
    const fine = [];
    const keeping = plugin('fixture/fine', {
      onLog: (event) => {
        fine.push(event.message);
      },
    });

    const inner = new Command('inner', { description: 'The inner command.' }).action(({ log }) =>
      log.info('inner'),
    );

    const scenarios = {
      // The application is also invoked by name after the run, with its own env.
      'app-invoke': () =>
        new Application('probe', {
          description: 'Probe invocation by name.',
          plugins: [observing('fixture/first'), observing('fixture/second')],
        })
          .command(inner)
          .action(({ log }) => log.info('root')),
      // The caller cancels, so the run keeps its signal's code beside the hook's report.
      'cancelled-broken': () =>
        new Application('probe', {
          description: 'Probe a cancelled run.',
          plugins: [breaking(), keeping],
        }).action(({ log }) => {
          controller.abort(new Error('the caller stopped the run'));
          log.info('one');
          log.info('two');
        }),
      // An action's invoke delivers to the parent run's destination, and captures none of it.
      invoke: () =>
        new Application('probe', {
          description: 'Probe a nested run.',
          plugins: [observing('fixture/first'), observing('fixture/second')],
        })
          .command(inner)
          .action(async ({ invoke }) => {
            const outcome = await invoke(['inner'], {});
            printed.push({ messages: outcome.messages, output: outcome.output });
          }),
      // Two plugins receive each event in installation order, the same frozen object.
      order: () =>
        new Application('probe', {
          description: 'Probe delivery order.',
          plugins: [observing('fixture/first'), observing('fixture/second')],
        }).action(({ log }) => log.info('one')),
      // The run's stdout refuses a write and a hook throws, so two reports follow.
      'stdout-and-hook-broken': () =>
        new Application('probe', {
          description: 'Probe two plain fallback reports.',
          plugins: [breaking(), keeping],
        }).action(({ log, out }) => {
          log.info('one');
          out.print('rows');
        }),
      'throws-on-event': () =>
        new Application('probe', {
          description: 'Probe a throwing hook.',
          plugins: [breaking(), keeping],
        }).action(twoLogs),
      // The hook throws on core's own fatal event alone.
      'throws-on-fatal': () =>
        new Application('probe', {
          description: 'Probe a hook that breaks on a failure event.',
          plugins: [breaking('fatal'), keeping],
        }).action(() => {
          throw new TypeError('The probe failed.');
        }),
    };

    const build = scenarios[scenario];
    if (build === undefined) {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
    const app = declare(build);
    const release =
      fixtureEnv.FIXTURE_BUILD === undefined
        ? {}
        : { release: { build: fixtureEnv.FIXTURE_BUILD } };
    const code = await app.run({
      process: createProcess({
        argv,
        env: { PROBE: 'run' },
        platform: 'probe-os',
        stderr,
        ...(scenario === 'stdout-and-hook-broken' ? { stdout: fullDisk() } : {}),
        ...release,
      }),
      signal: controller.signal,
    });
    if (scenario === 'app-invoke') {
      printed.push({ marker: 'invoke' });
      const outcome = await app.invoke(
        ['inner'],
        {},
        { process: createProcess({ env: { PROBE: 'invoked' }, platform: 'named-os' }) },
      );
      printed.push({ messages: outcome.messages, output: outcome.output });
    }
    writeStdout(`printed:${JSON.stringify(printed)}\n`);
    writeStdout(`written:${JSON.stringify(written.join(''))}\n`);
    writeStdout(`calls:${calls.broken}\n`);
    writeStdout(`fine:${JSON.stringify(fine)}\n`);
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function fullDisk() {
  return new Writable({
    write(_chunk, _encoding, callback) {
      callback(Object.assign(new Error('write ENOSPC'), { code: 'ENOSPC' }));
    },
  });
}
const twoLogs = ({ log }) => {
  log.info('one');
  log.info('two');
};

export { runFixture as run };
