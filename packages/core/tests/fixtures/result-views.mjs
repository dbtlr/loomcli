import { Application, Command } from '@loomcli/core';

const scenario = process.argv[2];
const mode = process.argv[3];

const rows = [{ source: 'one.txt' }, { source: 'two words.txt' }];

/** The row view the declaration names first, which every unreshaped scenario renders through. */
const list = {
  head: () => 'PATHS\n',
  row: (row, index) => `${index}: ${row.source}\n`,
  tail: () => 'END\n',
};

/** The replacement one call installs under the name the declaration already holds. */
const relisted = { row: (row) => `- ${row.source}\n` };

/** The whole view the declaration names second, which core collects the sequence for. */
const table = { render: (all) => `${all.length} rows\n` };

/** The view an importing application appends under a name the declaration never held. */
const wide = { render: (all) => `wide ${all.length}\n` };

/** A second appended view, which a later call adds without naming a default of its own. */
const narrow = { render: (all) => `narrow ${all.length}\n` };

const act = ({ out }) => out.results(rows);

/** The Command an importing application receives: complete, with its action already registered. */
function imported() {
  return new Command('paths').rows({ views: { list, table } }).action(act);
}

/**
 * Each reshaping, applied to the declaration the scenario places it on. Every entry but the last
 * reshapes a Command whose action is already registered, which is how an importing application
 * changes presentation without touching the action.
 */
const scenarios = {
  append: () => imported().views({ wide }),
  // The same call before the action, which the declaration publishes in every state.
  'before-action': () =>
    new Command('paths').rows({ views: { list, table } }).views({ wide }).action(act),
  'missing-default': () => imported().views({ wide }).views({}, { default: 'narrow' }),
  'move-default': () => imported().views({ wide }, { default: 'wide' }),
  'persist-default': () => imported().views({ wide }, { default: 'wide' }).views({ narrow }),
  replace: () => imported().views({ list: relisted }),
};

/** The root declares and reshapes the same result, so the call reads the same on an Application. */
function rootApplication() {
  return new Application('reshaped')
    .rows({ views: { list, table } })
    .views({ wide }, { default: 'wide' })
    .action(act);
}

function build() {
  return scenario === 'root'
    ? rootApplication()
    : new Application('reshaped').command(scenarios[scenario]());
}

const app = build();
process.stdout.write('assembled\n');

if (mode === 'inspect') {
  try {
    const graph = app.inspect();
    const node = scenario === 'root' ? graph.root : graph.root.children[0];
    process.stdout.write(`${JSON.stringify(node.result)}\n`);
  } catch (error) {
    process.stdout.write(`declaration:${error.exitCode}: ${error.message}\n`);
  }
} else {
  const code = await app.run({ host: { argv: scenario === 'root' ? [] : ['paths'] } });
  process.stdout.write(`resolved:${code}\n`);
}
