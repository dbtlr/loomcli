import { Application, Command, DeclarationError, diagnosticRule, plugin } from '@loomcli/core';

import { scenario as fixtureScenario } from '../scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const scenario = fixtureWords[0];
    const build = fixtureWords[1] ?? 'distributed';

    /** The options each Application declares. */
    const probe = { description: 'Probe the graph.' };

    /** The release facts each run reads, which render a build fault by the build a test names. */
    const release = { build };

    /** Prints one line of JSON to stdout, the fixture's report. */
    function print(value) {
      writeStdout(`${JSON.stringify(value)}\n`);
    }

    /** A stream that keeps what a run writes, so the report reads it back as text. */

    /** One run through argv, with its exit code and what it wrote to each stream. */
    async function runCaptured(app, argv) {
      const mock = createProcess({ argv, record: false, release });
      const exitCode = await app.run({ process: mock });
      return { exitCode, stderr: mock.stderr.text, stdout: mock.stdout.text };
    }

    /** Every Command path in one graph, depth first, as the hook saw it. */

    const rejecting = diagnosticRule('@fixture/judge/shared-name', {
      explanation: 'Each Command describes its own job.',
      headline: 'Two Commands share one description',
    });

    if (scenario === 'order') {
      const calls = [];
      const graphs = [];
      // Each plugin records what its hook saw, so the report reads the order and the facts.
      const judge = (identity) =>
        plugin(identity, {
          onGraphBuilt: (graph) => {
            graphs.push(graph);
            const count = graph.root.children.find((child) => child.name === 'count');
            calls.push({
              commands: paths(graph.root),
              identity,
              options: count?.options.map((option) => option.name) ?? [],
            });
            return undefined;
          },
        });
      const attaching = plugin('@fixture/attach', {
        commands: [new Command('doctor').action(() => undefined)],
        onCommandAttach: (command) =>
          command.name === 'count' ? command.option('format', { type: 'string' }) : command,
      });
      let readByAction = undefined;
      const app = new Application('probe', {
        plugins: [attaching, judge('@fixture/first'), judge('@fixture/second')],
      })
        .command(
          new Command('count').action(({ graph }) => {
            readByAction = graph;
          }),
        )
        .command(
          new Command('caller').action(async ({ invoke }) => {
            await invoke(['count'], {});
          }),
        );
      const marks = [];
      const mark = (label) => marks.push({ calls: calls.length, label });
      await runCaptured(app, ['count']);
      mark('run');
      const sameAsAction = graphs.at(-1) === readByAction && graphs.at(-2) === readByAction;
      app.inspect();
      mark('inspect');
      await app.invoke(['count'], {}, { process: createProcess({ release }) });
      mark('app.invoke');
      await app.invoke(['caller'], {}, { process: createProcess({ release }) });
      mark('app.invoke with an action invoke');
      print({ calls: calls.slice(0, 2), marks, sameAsAction });
    } else if (scenario === 'reject') {
      const seen = [];
      const judge = plugin('@fixture/judge', {
        onFailure: () => {
          seen.push('onFailure');
          return undefined;
        },
        onGraphBuilt: () => {
          seen.push('judge');
          throw new DeclarationError(rejecting, {
            correction: 'Describe what each Command does in its own words.',
            sentence: 'Commands "a" and "b" share one description.',
          });
        },
      });
      const later = plugin('@fixture/later', {
        onGraphBuilt: () => {
          seen.push('later');
          return undefined;
        },
      });
      const app = new Application('probe', { ...probe, plugins: [judge, later] }).action(() =>
        seen.push('action'),
      );
      const ran = await runCaptured(app, []);
      const afterRun = [...seen];
      let inspected = 'returned';
      try {
        app.inspect();
      } catch (error) {
        inspected = error instanceof DeclarationError ? error.message : 'threw something else';
      }
      print({ afterRun, inspected, ran });
    } else if (scenario === 'broken') {
      const app = new Application('probe', {
        ...probe,
        plugins: [
          plugin('@fixture/broken', {
            onGraphBuilt: () => {
              throw new TypeError('the hook broke');
            },
          }),
        ],
      }).action(() => undefined);
      print(await runCaptured(app, []));
    } else if (scenario === 'cause') {
      // The value a broken hook threw is the fault's cause.
      const thrown = new TypeError('the hook broke');
      const app = new Application('probe', {
        plugins: [
          plugin('@fixture/broken', {
            onGraphBuilt: () => {
              throw thrown;
            },
          }),
        ],
      }).action(() => undefined);
      try {
        app.inspect();
        print('returned');
      } catch (error) {
        print({ cause: error instanceof DeclarationError && error.cause === thrown });
      }
    } else if (scenario === 'frozen') {
      const seen = [];
      const writing = plugin('@fixture/writing', {
        onGraphBuilt: (graph) => {
          try {
            graph.root.children.push(graph.root);
            seen.push('mutated');
          } catch {
            seen.push('threw');
          }
          return undefined;
        },
      });
      const app = new Application('probe', { ...probe, plugins: [writing] })
        .command(new Command('leaf', { description: 'Do nothing.' }).action(() => undefined))
        .action(({ graph, out }) => out.print(String(graph.root.children.length)));
      const quiet = await runCaptured(app, []);
      const unguarded = new Application('probe', {
        ...probe,
        plugins: [
          plugin('@fixture/unguarded', {
            onGraphBuilt: (graph) => {
              graph.root.children.push(graph.root);
              return undefined;
            },
          }),
        ],
      }).action(() => undefined);
      print({ quiet, seen, unguarded: await runCaptured(unguarded, []) });
    }

    // Each run above set the process's exit status; the report itself succeeded.
    fixture.exitCode = 0;
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

function paths(node) {
  return [node.path.join(' '), ...node.children.flatMap(paths)];
}

export { runFixture as run };
