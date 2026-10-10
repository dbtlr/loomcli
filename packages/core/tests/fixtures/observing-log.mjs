import { Writable } from 'node:stream';

import { Application, Command, plugin } from '@loomcli/core';

import { declare } from './declare.mjs';

const [scenario, ...argv] = process.argv.slice(2);

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

/** A hook that breaks as the scenario names, counting every call it receives. */
const calls = { broken: 0 };
function breaking(how, only) {
  return plugin('fixture/broken', {
    onLog: (event) => {
      if (only !== undefined && event.level !== only) {
        return undefined;
      }
      calls.broken += 1;
      if (how === 'throws') {
        throw new TypeError('Cannot observe.');
      }
      if (how === 'true') {
        return true;
      }
      return Promise.reject(new Error('Rejected late.'));
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

const twoLogs = ({ log }) => {
  log.info('one');
  log.info('two');
};

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
      plugins: [breaking('throws'), keeping],
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
  'not-function': () => plugin('@acme/stacks', { onLog: 'stacks' }),
  // Two plugins receive each event in installation order, the same frozen object.
  order: () =>
    new Application('probe', {
      description: 'Probe delivery order.',
      plugins: [observing('fixture/first'), observing('fixture/second')],
    }).action(({ log }) => log.info('one')),
  'returns-promise': () =>
    new Application('probe', {
      description: 'Probe a hook that returns a promise.',
      plugins: [breaking('promise'), keeping],
    }).action(twoLogs),
  'returns-true': () =>
    new Application('probe', {
      description: 'Probe a hook that returns true.',
      plugins: [breaking('true'), keeping],
    }).action(twoLogs),
  'throws-on-event': () =>
    new Application('probe', {
      description: 'Probe a throwing hook.',
      plugins: [breaking('throws'), keeping],
    }).action(twoLogs),
  // The hook throws on core's own fatal event alone.
  'throws-on-fatal': () =>
    new Application('probe', {
      description: 'Probe a hook that breaks on a failure event.',
      plugins: [breaking('throws', 'fatal'), keeping],
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
  process.env.FIXTURE_BUILD === undefined ? {} : { release: { build: process.env.FIXTURE_BUILD } };
const code = await app.run({
  host: { argv, env: { PROBE: 'run' }, platform: 'probe-os', stderr, ...release },
  signal: controller.signal,
});
if (scenario === 'app-invoke') {
  printed.push({ marker: 'invoke' });
  const outcome = await app.invoke(
    ['inner'],
    {},
    { host: { env: { PROBE: 'invoked' }, platform: 'named-os' } },
  );
  printed.push({ messages: outcome.messages, output: outcome.output });
}
process.stdout.write(`printed:${JSON.stringify(printed)}\n`);
process.stdout.write(`written:${JSON.stringify(written.join(''))}\n`);
process.stdout.write(`calls:${calls.broken}\n`);
process.stdout.write(`fine:${JSON.stringify(fine)}\n`);
process.stdout.write(`resolved:${code}\n`);
