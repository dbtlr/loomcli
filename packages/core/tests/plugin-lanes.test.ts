import { Application, Command, plugin } from '@loomcli/core';
import type { LogDestination } from '@loomcli/core';
import { mockProcess } from '@loomcli/testing';
import { expect, test } from 'vite-plus/test';

/**
 * The lanes a plugin's hooks write their `-v` and `-vv` lines through, under ADR-0165: an
 * `onEnvironment` hook's `out.debug` and `out.trace`, and an `onLog` hook's `destination.out`, the
 * outermost run's lanes, which follow that run's verbosity.
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

/** A plugin whose environment hook says one line in each lane. */
const speaks = plugin('fixture/speaks', {
  onEnvironment: async ({ out }) => {
    await out.debug('Read the environment.');
    await out.trace('Looked at the environment.');
  },
});

/** Runs an application with the hook plugin, and answers its stderr. */
async function environmentLines(argv: readonly string[]): Promise<string> {
  const mock = mockProcess({ argv });
  await new Application('app', { plugins: [loud, speaks] }).action(() => {}).run({ process: mock });
  return mock.stderr.text;
}

test("an environment hook's debug and trace lines follow the run's verbosity", async () => {
  await expect(environmentLines([])).resolves.toBe('');
  await expect(environmentLines(['-L'])).resolves.toBe('› Read the environment.\n');
  await expect(environmentLines(['-LL'])).resolves.toBe(
    '› Read the environment.\n  ┆ Looked at the environment.\n',
  );
});

/** A plugin whose `onLog` hook writes one debug and one trace line through its destination per event. */
function observer(seen: LogDestination[]) {
  return plugin('fixture/observer', {
    onLog: (event, destination) => {
      seen.push(destination);
      void destination.out.debug(`Saw ${event.message}`).catch(() => {});
      void destination.out.trace(`Traced ${event.message}`).catch(() => {});
      return undefined;
    },
  });
}

/** The stderr of a run whose action logs one event, which the observer's lanes answer. */
async function observedLines(argv: readonly string[]): Promise<string> {
  const mock = mockProcess({ argv });
  await new Application('app', { plugins: [loud, observer([])] })
    .action(({ log }) => {
      log.info('Indexed.');
    })
    .run({ process: mock });
  return mock.stderr.text;
}

test("an onLog hook's lanes write to the outermost run's stderr at that run's verbosity", async () => {
  await expect(observedLines([])).resolves.toBe('');
  await expect(observedLines(['-L'])).resolves.toBe('› Saw Indexed.\n');
  await expect(observedLines(['-LL'])).resolves.toBe('› Saw Indexed.\n  ┆ Traced Indexed.\n');
});

test("under an action's invoke the hook's lanes follow the outer run, not the nested one", async () => {
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
  expect(mock.stderr.text).toBe('› Saw Outer.\n› Saw Nested.\n');
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
  expect(verbose).toMatchObject({ messages: '› Saw Called.\n', status: 'completed' });
});
