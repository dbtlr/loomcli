import { Application, Command, plugin } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess } = fixture;
  try {
    // The graph and routed node the middleware received in this run, which the action compares against.
    const seen = { command: undefined, graph: undefined };

    const observing = async ({ command, graph, next }) => {
      seen.command = command;
      seen.graph = graph;
      await next();
    };

    /** What one action reports about the graph and the routed node it received. */
    const report = async ({ command, graph, out }) => {
      let node = graph.root;
      for (const name of command.path) {
        node = node.children.find((child) => child.name === name);
      }
      await out.print(
        JSON.stringify({
          commandFrozen: Object.isFrozen(command),
          graphFrozen: Object.isFrozen(graph),
          name: graph.name,
          own: node === command,
          path: command.path,
          sameCommand: seen.command === undefined ? null : seen.command === command,
          sameGraph: seen.graph === undefined ? null : seen.graph === graph,
        }),
      );
    };

    const scenarios = {
      // A middleware runs first, so the action compares its values with the middleware's.
      observed: () =>
        new Application('observed', {
          plugins: [
            plugin('@fixture/observer', {
              middleware: { activate: 'always', load: () => ({ default: observing }) },
            }),
          ],
        })
          .command(new Command('cache').command(new Command('list').alias('l').action(report)))
          .action(report),
      // A plugin Command's action receives the graph and its node like any other action.
      plugged: () =>
        new Application('plugged', {
          plugins: [
            plugin('@fixture/doctor', { commands: [new Command('doctor').action(report)] }),
          ],
        }).action(report),
    };

    const [scenario, ...argv] = words;
    await scenarios[scenario]().run({ process: createProcess({ argv }) });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
