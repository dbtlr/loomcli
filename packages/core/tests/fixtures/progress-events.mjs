import { Application, Command, FatalError, plugin } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    /**
     * Invocations by name whose actions report progress through live regions. argv[2] names the
     * scenario, and the fixture prints one line of JSON: what each observer received, and what the
     * scenario noted.
     */
    const scenario = words[0];

    /** Prints one line of JSON to the real stdout, which no invocation by name ever writes to. */
    function print(value) {
      writeStdout(`${JSON.stringify(value)}\n`);
    }

    /** An observer that keeps every event it receives, and the list it keeps them in. */

    /** One Application whose root runs the action, and the events an observed call of it receives. */
    async function observed(action, options = {}) {
      const { events, onProgress } = options.observer ?? observer();
      const app = new Application('probe', {
        description: 'Report progress.',
        plugins: options.plugins ?? [],
      }).action(action);
      const outcome = await app.invoke(
        [],
        {},
        { onProgress, process: createProcess(), signal: options.signal },
      );
      return { events, status: outcome.status };
    }

    if (scenario === 'order') {
      const notes = {};
      const watching = observer();
      const { events } = await observed(
        async ({ out }) => {
          const region = out.region();
          region.report({ label: 'Fetching', total: 3 });
          notes.receivedBeforeReturn = watching.events.length;
          region.report({ completed: 1 });
          region.report({ completed: 2, label: 'Fetching more' });
          await region.end();
        },
        { observer: watching },
      );
      print({ events, frozen: events.map((event) => Object.isFrozen(event)), notes });
    }

    if (scenario === 'numbering') {
      const { events } = await observed(async ({ out, style }) => {
        const first = out.region();
        const second = out.region();
        second.report({ completed: 4 });
        first.report({ label: style.highlight('x') });
      });
      print({ events });
    }

    if (scenario === 'ends') {
      const cancelling = new AbortController();
      print({
        cancelled: await observed(
          async ({ out }) => {
            out.region().report({ label: 'cancelled' });
            cancelling.abort();
            await new Promise((resolve) => {
              setTimeout(resolve, 10);
            });
          },
          { signal: cancelling.signal },
        ),
        endFailed: await observed(async ({ out }) => {
          const region = out.region();
          region.report({ label: 'end failed' });
          await region.end('failed');
        }),
        returned: await observed(({ out }) => {
          out.region().report({ label: 'returned' });
        }),
        silent: await observed(async ({ out }) => {
          await out.region().end();
        }),
        thrown: await observed(({ out }) => {
          out.region().report({ label: 'thrown' });
          throw new FatalError('It failed.');
        }),
      });
    }

    if (scenario === 'logging') {
      const heard = [];
      const hook = plugin('@fixture/hook', {
        onLog: (event) => {
          heard.push(event.message);
        },
      });
      const { events } = await observed(
        async ({ out }) => {
          const region = out.region();
          region.report({ label: 'reported', total: 2 });
          region.report({ completed: 1 });
          await region.end();
        },
        { plugins: [hook] },
      );
      print({ events: events.length, heard });
    }

    if (scenario === 'nested') {
      const outer = observer();
      const inner = observer();
      const app = new Application('probe', { description: 'Report progress.' })
        .command(
          new Command('inner', { description: 'The inner command.' }).action(({ out }) => {
            out.region().report({ label: 'inner' });
          }),
        )
        .action(async ({ invoke, out }) => {
          out.region().report({ label: 'outer' });
          await invoke(['inner'], {}, { onProgress: inner.onProgress });
          await invoke(['inner'], {});
        });
      await app.invoke([], {}, { onProgress: outer.onProgress, process: createProcess() });
      print({ inner: inner.events, outer: outer.events });
    }

    if (scenario === 'throws') {
      const thrown = new Error('the observer broke');
      const notes = { calls: 0, finished: false };
      const app = new Application('probe', { description: 'Report progress.' }).action(
        async ({ out }) => {
          const region = out.region();
          region.report({ label: 'one' });
          region.report({ label: 'two' });
          await out.info('still running');
          await region.end();
          notes.finished = true;
        },
      );
      notes.rejected = await app
        .invoke(
          [],
          {},
          {
            onProgress: () => {
              notes.calls += 1;
              throw thrown;
            },
            process: createProcess(),
          },
        )
        .then(
          () => 'resolved',
          (error) => error === thrown,
        );
      print(notes);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function observer() {
  const events = [];
  return {
    events,
    onProgress: (event) => {
      events.push(event);
    },
  };
}

export { runFixture as run };
