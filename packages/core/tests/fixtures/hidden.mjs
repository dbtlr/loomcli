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

/** A hidden Command routes and runs; only a listing, the candidates included, omits it. */
function graph() {
  const clear = new Command('clear').action(report('clear'));
  const trace = new Command('trace', { hidden: true }).action(report('trace'));
  const cache = new Command('cache').command(clear).command(trace);
  // Every child of this group is hidden, so a routing error at it offers no candidates.
  const secrets = new Command('secrets').command(
    new Command('dump', { hidden: true }).action(report('dump')),
  );
  const debug = new Command('debug', { hidden: true }).action(report('debug'));
  return new Application('hidden', {
    views,
  })
    .globalOption('file', { short: 'f', type: 'string' })
    .command(cache)
    .command(secrets)
    .command(debug)
    .action(report('root'));
}

/** The same graph with every child of the root hidden, so the root group offers none either. */
function rootGraph() {
  return new Application('hidden', {
    views,
  })
    .globalOption('file', { short: 'f', type: 'string' })
    .command(new Command('debug', { hidden: true }).action(report('debug')));
}

const build = process.argv[2] === 'root' ? rootGraph : graph;
const code = await build().run({ host: { argv: process.argv.slice(3) } });
process.stdout.write(`resolved:${code}\n`);
