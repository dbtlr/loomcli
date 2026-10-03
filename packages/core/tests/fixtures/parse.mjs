import { Application, Command, override, plugin, UsageError } from '@loomcli/core';

const [scenario, ...argv] = process.argv.slice(2);

/** What a usage failure carries and the path routing reached, so a test reads both. */
const facts = {
  render: (failure, { path }) =>
    `${JSON.stringify({
      commands: failure.commands,
      message: failure.message,
      name: failure.name,
      path,
      spelling: failure.spelling,
    })}\n`,
};

/** Every action prints the path it ran on and the values it received. */
function report(command) {
  return ({ args, options, out, passthrough }) =>
    out.print(JSON.stringify({ args, command, options, passthrough }));
}

/** A help stand-in: `-h` takes the invocation over and prints the routed path. */
const help = plugin('@fixture/help', {
  middleware: {
    activate: ['help'],
    load: () => ({
      default: ({ command, out }) => out.print(`help:[${command.path.join(' ')}]`),
    }),
  },
  options: { help: { short: 'h', type: 'boolean' } },
});

/** A middleware that always runs and prints the global values and whether a request was handed over. */
const observer = plugin('@fixture/observer', {
  middleware: {
    activate: 'always',
    load: () => ({
      default: async ({ next, options, out, request }) => {
        await out.print(
          `observed:${JSON.stringify(options)}:${request === null ? 'null' : 'request'}`,
        );
        await next();
      },
    }),
  },
});

/**
 * The contract's graph: global `--file`, `-f` and `--quiet`, `-q`, a `get` with Boolean `-p` and
 * `-r` and a string `-d`, a `keys` that shares `-r`, a `cache` group whose `clear` declares
 * `--force`, and a hidden and a deprecated Command whose letters no listing shows.
 */
function kit() {
  const get = new Command('get')
    .argument('path', { required: true })
    .option('pretty', { short: 'p', type: 'boolean' })
    .option('raw', { short: 'r', type: 'boolean' })
    .option('depth', { short: 'd', type: 'string' })
    .action(report(['get']));
  const keys = new Command('keys')
    .argument('path', {})
    .option('raw', { short: 'r', type: 'boolean' })
    .action(report(['keys']));
  const cache = new Command('cache')
    .command(
      new Command('clear').option('force', { type: 'boolean' }).action(report(['cache', 'clear'])),
    )
    .command(new Command('list').action(report(['cache', 'list'])));
  const debug = new Command('debug', { hidden: true })
    .option('xray', { short: 'x', type: 'boolean' })
    .action(report(['debug']));
  const fetch = new Command('fetch', { deprecated: 'Use get instead.' })
    .option('yank', { short: 'y', type: 'boolean' })
    .action(report(['fetch']));
  const plugins = scenario === 'observed' ? [observer, help] : [help];
  return new Application('kit', { plugins, views: [override(UsageError, facts)] })
    .globalOption('file', { short: 'f', type: 'string' })
    .globalOption('quiet', { short: 'q', type: 'boolean' })
    .command(get)
    .command(keys)
    .command(cache)
    .command(debug)
    .command(fetch)
    .action(report([]));
}

const code = await kit().run({ host: { argv } });
process.stdout.write(`resolved:${code}\n`);
