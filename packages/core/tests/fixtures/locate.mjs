import { Application, Command, locate } from '@loomcli/core';

const dispatch = () => {};

// Globals cover a string with a short spelling, a Boolean with both polarities, and a Boolean short.
// The root takes an action and one local option, so a hyphen token can commit it.
// Its children cover an alias, a hidden child, a group, local options, and a variadic argument.
function kit() {
  const keys = new Command('keys')
    .alias('ls')
    .option('sort', { short: 's', type: 'boolean' })
    .option('depth', { short: 'd', type: 'string' })
    .option('field', { multiple: true, short: 'F', type: 'string' })
    .action(dispatch);
  const paths = new Command('paths')
    .option('format', { type: 'string' })
    .argument('root', { required: true })
    .argument('rest', { variadic: true })
    .action(dispatch);
  const debug = new Command('debug', { hidden: true }).action(dispatch);
  const cache = new Command('cache')
    .command(new Command('clear').action(dispatch))
    .command(new Command('list').alias('l').action(dispatch));
  return new Application('kit')
    .globalOption('file', { short: 'f', type: 'string' })
    .globalOption('color', { polarity: 'both', type: 'boolean' })
    .globalOption('quiet', { short: 'q', type: 'boolean' })
    .option('all', { short: 'a', type: 'boolean' })
    .command(keys)
    .command(paths)
    .command(debug)
    .command(cache)
    .action(dispatch);
}

/** The graph's own node at one path, found by canonical name. */
function nodeAt(graph, path) {
  let node = graph.root;
  for (const name of path) {
    node = node.children.find((child) => child.name === name);
  }
  return node;
}

/**
 * One position with every node reduced to its path or name. `own` says whether each node is the
 * given graph's own object, so the test asserts identity through the child process.
 */
function reduce(graph, position) {
  if (position.kind === 'none') {
    return position;
  }
  const { argument, command, option, ...rest } = position;
  const node = nodeAt(graph, command.path);
  let own = node === command;
  const reduced = { ...rest, command: command.path };
  if (option !== undefined) {
    reduced.option = option.name;
    own &&= [...graph.globals, ...node.options].includes(option);
  }
  if (argument !== undefined) {
    reduced.argument = argument.name;
    own &&= node.arguments.includes(argument);
  }
  return { ...reduced, own };
}

const mode = process.argv[3] ?? 'own';

/** The word count of each `long` case, too many for a call that spreads its arguments. */
const longCount = 200_000;

// `long` builds its word lists here, because they are too long for an argument.
const cases =
  mode === 'long'
    ? [
        ['--', ...Array.from({ length: longCount }, () => 'x'), ''],
        ['paths', ...Array.from({ length: longCount }, () => 'x'), ''],
      ]
    : JSON.parse(process.argv[2] ?? '[]');

// `foreign` hands locate a graph core did not produce, which is a caller's programming error.
// Every other mode hands it the graph `inspect()` returned.
const graph = mode === 'foreign' ? structuredClone(kit().inspect()) : kit().inspect();

const answers = cases.map((words) => {
  try {
    const position = locate(graph, words);
    return position instanceof Promise ? { async: true } : reduce(graph, position);
  } catch (error) {
    return { threw: error.name };
  }
});
process.stdout.write(`${JSON.stringify(answers)}\n`);
