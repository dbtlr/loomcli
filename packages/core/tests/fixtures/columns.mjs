import { Writable } from 'node:stream';

import { Application, Command, FatalError, incompleteResult, lanes, override } from '@loomcli/core';

const input = JSON.parse(process.argv[2] ?? '{}');
const scenario = input.scenario ?? 'destinations';
const long = Array.from({ length: 20 }, () => 'word').join(' ');

/** A view that reports the columns its context read, and whether wrap left a long line alone. */
const reading = (label) => ({
  render: (_value, context) =>
    `${label}:${String(context.columns)}:${context.wrap(long, context.columns) === long ? 'whole' : 'wrapped'}\n`,
});

if (scenario === 'destinations') {
  // Each destination reads its own width, from a host override or from process capture.
  const app = new Application('columns').action(async ({ host, out }) => {
    await out.render(null, reading('stdout'));
    await out.draw(null, reading('stderr'));
    await out.print(
      `host:${String(host.terminal.stdout.columns)},${String(host.terminal.stderr.columns)}`,
    );
  });
  await app.run({
    host: {
      argv: [],
      release: { build: 'distributed' },
      ...(input.env === undefined ? {} : { env: input.env }),
      ...(input.terminal === undefined ? {} : { terminal: input.terminal }),
    },
  });
} else if (scenario === 'invoke') {
  // An invocation by name has no terminal, whatever COLUMNS the process holds.
  const app = new Application('columns', { description: 'Report columns.' }).command(
    new Command('show', { description: 'Show the columns.' }).action(async ({ out }) => {
      await out.render(null, reading('stdout'));
      await out.render(null, { render: (_value, context) => String(context.columns) });
    }),
  );
  const outcome = await app.invoke(['show'], {});
  process.stdout.write(JSON.stringify(outcome));
} else if (scenario === 'fresh') {
  // A getter-backed host whose width the action changes between render calls.
  let width = 100;
  const live = {
    get columns() {
      return width;
    },
    isTTY: true,
    rows: 24,
  };
  const at = (next) => {
    width = next;
  };
  async function* rows() {
    at(71);
    yield 'a';
    at(72);
    yield 'b';
    at(73);
  }
  async function* stopping() {
    yield 'a';
    at(44);
    throw new Error('The source broke.');
  }
  const app = new Application('columns', {
    views: [
      override(lanes.info, {
        render: (message, context) => reading(message).render(null, context).trimEnd(),
      }),
      override(incompleteResult, reading('incomplete')),
      override(FatalError, reading('failure')),
    ],
  })
    .command(
      new Command('pieces').action(async ({ out }) => {
        at(61);
        await out.render(null, reading('render'));
        at(62);
        await out.info('message');
        at(63);
        await out.draw(null, reading('draw'));
        at(70);
        await out.render(rows(), {
          head: (context) => reading('head').render(null, context),
          row: (row, _index, context) => reading(row).render(null, context),
          tail: (_count, context) => reading('tail').render(null, context),
        });
        at(90);
        out.fatal('Stop.');
      }),
    )
    .command(
      new Command('result').result({ views: { text: reading('result') } }).action(({ out }) => {
        at(65);
        return out.results(null);
      }),
    )
    .command(
      new Command('whole').rows({ views: { text: reading('whole') } }).action(({ out }) => {
        at(80);
        return out.results(
          (async function* whole() {
            yield 'a';
            at(81);
          })(),
        );
      }),
    )
    .command(
      new Command('stopped').action(async ({ out }) => {
        at(30);
        await out.render(stopping(), {
          row: (row, _index, context) => reading(row).render(null, context),
        });
      }),
    );
  process.exitCode = await app.run({
    host: {
      argv: input.argv,
      env: {},
      release: { build: 'distributed' },
      terminal: { stderr: live, stdin: { isTTY: false }, stdout: live },
    },
  });
} else if (scenario === 'failure') {
  // Core's default failure text on a narrow terminal, and an override that wraps its own text.
  const narrow = { columns: 20, isTTY: input.tty ?? true, rows: 24 };
  const views = input.override
    ? [
        override(FatalError, {
          render: (failure, context) =>
            `${String(context.columns)}|${context.wrap(failure.message, context.columns)}\n`,
        }),
      ]
    : [];
  const app = new Application('columns', { description: 'Fail.', views })
    .command(
      new Command('need', { description: 'Need an argument.' })
        .argument('name', { description: 'The required name.', required: true })
        .action(() => {}),
    )
    .command(
      new Command('stop', { description: 'Stop.' }).action(({ out }) =>
        out.fatal('The configuration file names a profile that this machine does not have.'),
      ),
    )
    .command(
      new Command('crash', { description: 'Crash.' }).action(() => {
        throw new TypeError('The fixture broke on purpose.');
      }),
    );
  process.exitCode = await app.run({
    host: {
      argv: input.argv,
      env: {},
      release: { build: 'distributed' },
      terminal: { stderr: narrow, stdin: { isTTY: false }, stdout: narrow },
    },
  });
} else if (scenario === 'draw') {
  // Out.draw counts rows against the real stderr width, never the COLUMNS-narrowed one.
  let width = 100;
  const live = {
    get columns() {
      return width;
    },
    isTTY: true,
    rows: 24,
  };
  const seen = [];
  const counted = [];
  const line = `${'x'.repeat(80)}\n`;
  const view = {
    render: (text, context) => {
      seen.push(context.columns);
      return text;
    },
  };
  await new Application('columns', { description: 'Draw.' })
    .action(async ({ out }) => {
      counted.push(await out.draw(line, view));
      width = 40;
      counted.push(await out.draw(line, view));
    })
    .run({
      host: {
        argv: [],
        env: { COLUMNS: '60' },
        release: { build: 'distributed' },
        stderr: new Writable({
          write: (_chunk, _encoding, done) => done(),
        }),
        terminal: { stderr: live, stdin: { isTTY: false }, stdout: live },
      },
    });
  process.stdout.write(JSON.stringify({ counted, seen }));
}
