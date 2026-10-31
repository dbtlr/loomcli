import { chmodSync } from 'node:fs';

import { Application, Command, FatalError } from '@loomcli/core';
import { logging } from '@loomcli/plugins/logging';
import type { LoggingError, LoggingSettings } from '@loomcli/plugins/logging';

/** What the fixture's `onError` does: write one line per failure, or throw from the callback. */
type OnError =
  | { readonly mode: 'print'; readonly write: (line: string) => void }
  | { readonly mode: 'throw' };

/** One line naming a failure's cause code, kind, path, and variable, as `print` writes it. */
function failureLine(error: LoggingError): string {
  const { cause, kind, path, variable } = error;
  const code = cause instanceof Error && 'code' in cause ? cause.code : undefined;
  return `onError:${JSON.stringify({ cause: code, kind, path, variable })}\n`;
}

/**
 * The settings a case names, with the `onError` it picks; with none, the plugin has none. The
 * console destination takes no `onError`.
 */
function settingsWith(
  declared: LoggingSettings | undefined,
  onError: OnError | undefined,
): LoggingSettings | undefined {
  if (onError === undefined || declared?.to === 'console') {
    return declared;
  }
  return {
    ...declared,
    onError: (error) => {
      if (onError.mode === 'throw') {
        throw new Error('The callback broke.');
      }
      onError.write(failureLine(error));
      return undefined;
    },
  };
}

const levels: readonly ('trace' | 'debug' | 'info' | 'warn' | 'error')[] = [
  'trace',
  'debug',
  'info',
  'warn',
  'error',
];

/** The application the logging cases run, in-process and from the process fixture. */
function loggingApplication(declared?: LoggingSettings, onError?: OnError) {
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

  /**
   * Ends the process right after the call, so a record that survives was written synchronously.
   * Only the process fixture runs it.
   */
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

  return new Application('heimdall', {
    description: 'A fixture application.',
    plugins: [logging(settingsWith(declared, onError))],
    version: '1.2.0',
  })
    .command(log)
    .command(burst)
    .command(defect)
    .command(fail)
    .command(leave)
    .command(heal)
    .action(() => undefined);
}

export { loggingApplication };
export type { OnError };
