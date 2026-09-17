import { Application, Command, plugin } from '@loomcli/core';

const scenario = process.argv[2];
const mode = process.argv[3];
const argv = process.argv.slice(4);

/** Writes one fact a hook read, so a test reads the sequence the build produced. */
function note(fact) {
  process.stdout.write(`${JSON.stringify(fact)}\n`);
}

/** The declared view every result in this fixture names. */
const text = { render: (value) => `text:${value}\n` };

/** The view a hook appends, so a reshaped record is visible in the rendered bytes. */
const json = { render: (value) => `json:${value}\n` };

/** The view a later hook puts in the earlier one's place, under the same name. */
const second = { render: (value) => `second:${value}\n` };

/** A middleware that writes the options the request carries, so a hook's option is visible. */
async function reading({ next, out, request }) {
  await out.print(`request:${JSON.stringify(request.options)}`);
  await next();
}

/** The plugin that reads the request, installed beside the hooks a scenario declares. */
function reader() {
  return plugin('@fixture/reader', {
    middleware: { activate: 'always', load: () => ({ default: reading }) },
  });
}

/** A hook that acts on the `count` Command alone, so every other Command passes through. */
function onCount(act) {
  return (command) => (command.name === 'count' ? act(command) : command);
}

/** The Command whose result a hook reads and reshapes. */
function counted(views = { text }) {
  return new Command('count')
    .result({ views })
    .action(({ options, out }) => out.results(JSON.stringify(options)));
}

/** The facts one hook reads off the Command it received. */
function facts(command) {
  return {
    arguments: command.arguments,
    hasAction: command.hasAction,
    name: command.name,
    options: command.options,
    path: command.path,
    result: command.result,
  };
}

/** A hook that records the facts of every Command it receives and reshapes none of them. */
function recording(command) {
  note(facts(command));
  return command;
}

/** Whether one write into a published list landed, so a frozen list reports the throw it raises. */
function attempt(write) {
  try {
    write();
    return 'mutated';
  } catch {
    return 'threw';
  }
}

const scenarios = {
  compose: () =>
    new Application('app', {
      plugins: [
        plugin('@acme/out', {
          onCommandAttach: onCount((command) => command.views({ json }, { default: 'json' })),
        }),
        plugin('@loomcli/plugins/format', {
          onCommandAttach: onCount((command) => {
            note({ identity: '@loomcli/plugins/format', views: command.result.views });
            return command.views({ json: second });
          }),
        }),
      ],
    })
      .command(counted())
      .action(({ out }) => out.print('root')),
  facts: () =>
    new Application('app', {
      plugins: [plugin('@fixture/facts', { onCommandAttach: recording })],
    })
      .command(counted({ json, text }))
      .command(
        new Command('get')
          .argument('path', { required: true })
          .option('raw', { type: 'boolean' })
          .action(({ out }) => out.print('get')),
      )
      .command(
        new Command('cache').command(
          new Command('clear').action(({ out }) => out.print('cleared')),
        ),
      )
      .action(({ out }) => out.print('root')),
  frozen: () =>
    new Application('app', {
      plugins: [
        plugin('@fixture/frozen', {
          onCommandAttach: onCount((command) => {
            note({
              arguments: attempt(() => command.arguments.push('tag')),
              options: attempt(() => command.options.push('raw')),
            });
            return command;
          }),
        }),
      ],
    })
      .command(counted())
      .action(({ out }) => out.print('root')),
  option: () =>
    new Application('app', {
      plugins: [
        reader(),
        plugin('@loomcli/plugins/format', {
          onCommandAttach: onCount((command) =>
            command.option('format', { description: 'Select the output format.', type: 'string' }),
          ),
        }),
      ],
    })
      .command(counted())
      .action(({ out }) => out.print('root')),
  root: () =>
    new Application('app', {
      plugins: [
        plugin('@loomcli/plugins/format', {
          onCommandAttach: (command) => {
            if (command.name !== null) {
              return command;
            }
            note({ name: command.name, path: command.path });
            return command.option('quiet', { type: 'boolean' });
          },
        }),
      ],
    })
      .command(counted())
      .action(({ options, out }) => out.print(`root:${JSON.stringify(options)}`)),
  views: () =>
    new Application('app', {
      plugins: [
        plugin('@loomcli/plugins/format', {
          onCommandAttach: onCount((command) => {
            const reshaped = command.views({ json }, { default: 'json' });
            note({ after: reshaped.result, before: command.result });
            return reshaped;
          }),
        }),
      ],
    })
      .command(counted())
      .action(({ out }) => out.print('root')),
};

/** The published facts of the `count` Command, which a hook declared part of. */
function inspected(graph) {
  const count = graph.root.children.find((child) => child.name === 'count');
  return {
    options: count.options.map(({ name, scope }) => ({ name, scope })),
    result: count.result,
  };
}

const application = scenarios[scenario];

if (mode === 'inspect') {
  note(inspected(application().inspect()));
} else {
  const code = await application().run({ host: { argv } });
  process.stdout.write(`resolved:${code}\n`);
}
