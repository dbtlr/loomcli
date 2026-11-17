import { Application, Command, plugin } from '@loomcli/core';
import type { LogDestination } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/**
 * The log lines a plugin's hooks say what they did with, under ADR-0174: an `onEnvironment` hook's
 * `log`, and an `onLog` hook's `destination.log`, whose events show at the outermost run's
 * verbosity, reach every other hook, and never reach the hook whose destination it is.
 */

/** A verbose mark, spelled -L, so a run can raise its verbosity. */
const loud = plugin('fixture/loud', {
  options: {
    loud: {
      control: true,
      description: 'Show more detail.',
      short: 'L',
      type: 'count',
      verbose: true,
    },
  },
});

/** A plugin whose environment hook logs one debug and one trace event. */
const speaks = plugin('fixture/speaks', {
  onEnvironment: ({ log }) => {
    log.debug('Read the environment.');
    log.trace('Looked at the environment.');
  },
});

/** Runs an application with the hook plugin, and answers its stderr. */
async function environmentLines(argv: readonly string[]): Promise<string> {
  const mock = mockProcess({ argv });
  await new Application('app', { plugins: [loud, speaks] }).action(() => {}).run({ process: mock });
  return mock.stderr.text;
}

test("an environment hook's log lines follow the run's verbosity", async () => {
  await expect(environmentLines([])).resolves.toBe('');
  await expect(environmentLines(['-L'])).resolves.toBe('› Read the environment.\n');
  await expect(environmentLines(['-LL'])).resolves.toBe(
    '› Read the environment.\n  ┆ Looked at the environment.\n',
  );
});

/**
 * A plugin whose `onLog` hook logs one debug and one trace event through its destination for each
 * event it hears, and records what it hears.
 */
function observer(seen: LogDestination[], heard: string[] = []) {
  return plugin('fixture/observer', {
    onLog: (event, destination) => {
      seen.push(destination);
      heard.push(event.message);
      destination.log.debug('Saw {message}', { message: event.message });
      destination.log.trace('Traced {message}', { message: event.message });
      return undefined;
    },
  });
}

/** A plugin whose `onLog` hook records each event's plugin and message. */
function recorder(heard: string[]) {
  return plugin('fixture/recorder', {
    onLog: (event) => {
      heard.push(`${String(event.plugin)} ${event.message}`);
    },
  });
}

/** The stderr of a run whose action logs one event, which the observer answers. */
async function observedLines(argv: readonly string[]): Promise<string> {
  const mock = mockProcess({ argv });
  await new Application('app', { plugins: [loud, observer([])] })
    .action(({ log }) => {
      log.info('Indexed.');
    })
    .run({ process: mock });
  return mock.stderr.text;
}

test("an onLog hook's log lines show at the outermost run's verbosity, after the event it heard", async () => {
  await expect(observedLines([])).resolves.toBe('');
  await expect(observedLines(['-L'])).resolves.toBe('› Indexed.\n› Saw Indexed.\n');
  await expect(observedLines(['-LL'])).resolves.toBe(
    '› Indexed.\n› Saw Indexed.\n  ┆ Traced Indexed.\n',
  );
});

test("a hook's own destination.log reaches every other hook and never itself", async () => {
  const own: string[] = [];
  const other: string[] = [];
  await new Application('app', { plugins: [loud, observer([], own), recorder(other)] })
    .action(({ log }) => {
      log.info('Indexed.');
    })
    .run({ process: mockProcess() });
  expect(own).toEqual(['Indexed.']);
  expect(other).toEqual([
    'fixture/observer Saw {message}',
    'fixture/observer Traced {message}',
    'null Indexed.',
  ]);
});

test("under an action's invoke the hook's lines follow the outer run, not the nested one", async () => {
  const mock = mockProcess({ argv: ['-L', 'outer'] });
  const seen: LogDestination[] = [];
  const app = new Application('app', { plugins: [loud, observer(seen)] })
    .command(
      new Command('inner').action(({ log }) => {
        log.info('Nested.');
      }),
    )
    .command(
      new Command('outer').action(async ({ invoke, log, out }) => {
        log.info('Outer.');
        const outcome = await invoke(['inner'], {});
        await out.print(JSON.stringify(outcome.status === 'completed' ? outcome.messages : null));
      }),
    );
  await app.run({ process: mock });
  expect(mock.stderr.text).toBe('› Outer.\n› Saw Outer.\n› Nested.\n› Saw Nested.\n');
  expect(mock.stdout.text).toBe('""\n');
  expect(seen).toHaveLength(2);
  expect(new Set(seen).size).toBe(1);
});

test("under app.invoke the hook's lines land in the call's messages when its values ask", async () => {
  const app = new Application('app', { plugins: [loud, observer([])] }).action(({ log }) => {
    log.info('Called.');
  });
  const quiet = await app.invoke([], {}, { process: mockProcess() });
  const verbose = await app.invoke([], { options: { loud: 1 } }, { process: mockProcess() });
  expect(quiet).toMatchObject({ messages: '', status: 'completed' });
  expect(verbose).toMatchObject({ messages: '› Called.\n› Saw Called.\n', status: 'completed' });
});
