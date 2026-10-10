import { chmodSync } from 'node:fs';

import { Application, Command, FatalError } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';

const [scenario, ...argv] = process.argv.slice(2);

/**
 * The settings a test names as JSON, with an `onError` the test picks: `print` writes one line
 * for each failure to stdout, and `throw` throws from the callback. With none, the plugin has none.
 */
function settings() {
  const named = process.env.FIXTURE_SETTINGS;
  const declared = named === undefined ? undefined : JSON.parse(named);
  const mode = process.env.FIXTURE_ON_ERROR;
  if (mode === undefined) {
    return declared;
  }
  return {
    ...declared,
    onError: (error) => {
      if (mode === 'throw') {
        throw new Error('The callback broke.');
      }
      const { cause, kind, path, variable } = error;
      process.stdout.write(
        `onError:${JSON.stringify({ cause: cause?.code, kind, path, variable })}\n`,
      );
    },
  };
}

/** The host a test replaces: its `env` as JSON and its platform, each left alone when unnamed. */
function host() {
  const env = process.env.FIXTURE_HOST_ENV;
  const platform = process.env.FIXTURE_PLATFORM;
  return {
    ...(env === undefined ? {} : { env: JSON.parse(env) }),
    ...(platform === undefined ? {} : { platform }),
  };
}

const levels = ['trace', 'debug', 'info', 'warn', 'error'];

const log = new Command('log', { description: 'Log one event at each level.' }).action(
  ({ log: record }) => {
    for (const level of levels) {
      record[level](`At ${level}.`, { level });
    }
  },
);

/** Logs `count` records, each carrying `size` bytes of payload and numbered after `label`. */
const burst = new Command('burst', { description: 'Log numbered records.' })
  .argument('count', { description: 'How many.', required: true })
  .argument('size', { description: 'The payload size.', required: true })
  .argument('label', { description: 'The label before the number.', required: true })
  .action(({ args, log: record }) => {
    for (let number = 1; number <= Number(args.count); number += 1) {
      record.info(`${args.label}${number}`, { payload: 'x'.repeat(Number(args.size)) });
    }
  });

const defect = new Command('defect', { description: 'Log, then throw a defect.' }).action(
  ({ log: record }) => {
    record.info('Before the defect.');
    throw new TypeError('The action failed.');
  },
);

const fail = new Command('fail', { description: 'Log, then fail the run.' }).action(
  ({ log: record }) => {
    record.info('Before the failure.');
    throw new FatalError('The run failed.');
  },
);

/** Ends the process right after the call, so a record that survives was written synchronously. */
const leave = new Command('leave', { description: 'Log, then exit at once.' }).action(
  ({ log: record }) => {
    record.info('Before the exit.');
    process.exit(3);
  },
);

/** Logs, makes a directory writable, and logs again, as an operator fixing permissions would. */
const heal = new Command('heal', { description: 'Log before and after a directory heals.' })
  .argument('directory', { description: 'The directory to make writable.', required: true })
  .action(({ args, log: record }) => {
    record.info('Before healing.');
    chmodSync(args.directory, 0o755);
    record.info('After healing.');
  });

const app = new Application('heimdall', {
  description: 'A fixture application.',
  plugins: [logging(settings())],
  version: '1.2.0',
})
  .command(log)
  .command(burst)
  .command(defect)
  .command(fail)
  .command(leave)
  .command(heal)
  .action(() => undefined);

if (scenario === 'invoke') {
  // An invocation by name writes to no process stream. Its host may replace the captured env and platform.
  const outcome = await app.invoke(argv, {}, { host: host() });
  process.stdout.write(`invoked:${outcome.status}\n`);
} else {
  process.exitCode = await app.run({ host: { argv: [scenario, ...argv], ...host() } });
}
