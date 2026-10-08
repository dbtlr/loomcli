import {
  Application,
  Command,
  NonCallableCommandError,
  override,
  UnknownCommandError,
} from '@loomcli/core';

const report =
  (command) =>
  ({ out }) =>
    out.print(command);

/** The routing failures serialize their own facts, so a test reads the candidates they carry. */
const views = [
  override(UnknownCommandError, {
    render: ({ candidates, message, token }) =>
      `${JSON.stringify({ candidates, message, token })}\n`,
  }),
  override(NonCallableCommandError, {
    render: ({ candidates, command, message }) =>
      `${JSON.stringify({ candidates, command, message })}\n`,
  }),
];

/**
 * A hidden or a deprecated Command routes and runs.
 * Only a listing, the candidates included, omits it.
 */
function graph() {
  const clear = new Command('clear').action(report('clear'));
  const trace = new Command('trace', { hidden: true }).action(report('trace'));
  const purge = new Command('purge', { deprecated: 'Use clear instead.' }).action(report('purge'));
  const cache = new Command('cache').command(clear).command(trace).command(purge);
  // Every child of this group is hidden or deprecated, so a routing error at it offers none.
  const secrets = new Command('secrets')
    .command(new Command('dump', { hidden: true }).action(report('dump')))
    .command(new Command('leak', { deprecated: 'Use dump instead.' }).action(report('leak')));
  const debug = new Command('debug', { hidden: true }).action(report('debug'));
  const legacy = new Command('legacy', { deprecated: 'Use cache instead.' }).action(
    report('legacy'),
  );
  return new Application('hidden', {
    views,
  })
    .globalOption('file', { short: 'f', type: 'string' })
    .command(cache)
    .command(legacy)
    .command(secrets)
    .command(debug)
    .action(report('root'));
}

/**
 * The same graph with every child of the root hidden or deprecated.
 * The root group offers none either.
 */
function rootGraph() {
  return new Application('hidden', {
    views,
  })
    .globalOption('file', { short: 'f', type: 'string' })
    .command(new Command('debug', { hidden: true }).action(report('debug')))
    .command(new Command('legacy', { deprecated: 'Use debug instead.' }).action(report('legacy')));
}

/** A root group with a current child, so the root's own sentence offers it. */
function currentRootGraph() {
  return new Application('hidden', {
    views,
  })
    .command(new Command('get').action(report('get')))
    .command(new Command('legacy', { deprecated: 'Use get instead.' }).action(report('legacy')));
}

const graphs = { current: currentRootGraph, graph, root: rootGraph };
const build = graphs[process.argv[2]];
const code = await build().run({
  host: { argv: process.argv.slice(3), release: { build: 'distributed' } },
});
process.stdout.write(`resolved:${code}\n`);
