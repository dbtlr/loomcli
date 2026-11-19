import { Application, Command, processHandle } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import { verbose } from '@loomcli/plugins/verbose';
import { progress } from '@loomcli/prompts';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

/**
 * One run of an application whose logging plugin writes records to the console at `debug`, beside
 * the verbose plugin's `-v` and a progress line, as a real process whose stderr the test reads
 * through a pipe, so stderr is not a terminal.
 */
const order = new Command('order', {
  description: 'Log at three levels and warn while a progress line is open.',
}).action(async (context) => {
  const { log, out } = context;
  const line = progress(context, { label: 'Fetching records' });
  log.info('Fetched {count} records.', { count: 3 });
  await out.warn('The cache is stale.');
  log.warn('Retrying {host}.', { host: 'db' });
  log.debug('Skipped {count} rows.', { count: 1 });
  await line.end('Fetched 3 records.');
});

/**
 * Warns, logs, and ends the process at once, so whatever reaches stderr was written before the
 * process ended.
 */
const leave = new Command('leave', { description: 'Warn, log, then exit at once.' }).action(
  ({ log, out }) => {
    void out.warn('Leaving early.');
    log.info('Before the exit.');
    process.exit(3);
  },
);

/**
 * Registers a shutdown handler that logs and a newer one that throws, so each logs once the end has
 * written the run's queue, then ends the process at once.
 */
function stopping({ log, onShutdown }) {
  onShutdown(() => {
    log.info('Stopping.');
  });
  onShutdown(() => {
    throw new Error('Stuck.');
  });
}

const stop = new Command('stop', { description: 'Register shutdown handlers, then exit.' }).action(
  (context) => {
    stopping(context);
    process.exit(5);
  },
);

/** Queues a warning after the end's flush, then logs so both must reach stderr at once. */
function warningAtEnd(command, signal) {
  return new Command(command, { description: 'Warn and log in a shutdown handler.' }).action(
    async ({ log, onShutdown, out, signal: cancelledSignal }) => {
      onShutdown(() => {
        void out.warn('handler warn');
        log.info('handler record');
      });
      if (signal === undefined) {
        process.exit(7);
      }
      process.kill(process.pid, signal);
      await cancelled(cancelledSignal);
    },
  );
}

/** Resolves once the run is cancelled, holding one referenced timer until then. */
function cancelled(signal) {
  return new Promise((resolve) => {
    const held = setTimeout(resolve, 20_000);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(held);
        resolve();
      },
      { once: true },
    );
  });
}

/** Registers the shutdown handlers, then sends the process one signal and unwinds on its abort. */
function signalled(signal) {
  return new Command(signal === 'SIGTERM' ? 'term' : 'quit', {
    description: `Register shutdown handlers, then send the process ${signal}.`,
  }).action(async (context) => {
    stopping(context);
    process.kill(process.pid, signal);
    await cancelled(context.signal);
  });
}

/**
 * Logs, then kills the process with SIGKILL, which ends it inside the call with no exit event, as
 * an abort or a crash does, so only what was written in the log call reaches stderr.
 */
const kill = new Command('kill', { description: 'Log, then kill the process.' }).action(
  ({ log }) => {
    log.info('Before the kill.');
    process.kill(process.pid, 'SIGKILL');
  },
);

process.exitCode = await new Application('ledger', {
  description: 'A fixture application.',
  plugins: [logging({ level: 'debug', to: 'console' }), verbose()],
})
  .command(order)
  .command(leave)
  .command(stop)
  .command(signalled('SIGTERM'))
  .command(signalled('SIGQUIT'))
  .command(kill)
  .command(warningAtEnd('handler-exit'))
  .command(warningAtEnd('handler-term', 'SIGTERM'))
  .run({
    // The handle's home is the test's HOME as given, never the user database's.
    process: processHandle({ argv: process.argv.slice(2), home: fixtureHome(), platform: 'linux' }),
  });
