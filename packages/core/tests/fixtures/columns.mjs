import {
  Application,
  Command,
  FatalError,
  incompleteResult,
  InputError,
  lanes,
  nowrap,
  override,
  processHandle,
} from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const input = JSON.parse(fixtureWords[0] ?? '{}');
    const scenario = input.scenario ?? 'destinations';
    const long = Array.from({ length: 20 }, () => 'word').join(' ');

    /** A view that reports the columns its context read, and whether wrap left a long line alone. */
    const reading = (label) => ({
      render: (_value, context) =>
        `${label}:${String(context.columns)}:${context.wrap(long, context.columns) === long ? 'whole' : 'wrapped'}\n`,
    });

    if (scenario === 'destinations') {
      // Each destination reads its own width from the supplied terminal facts.
      const app = new Application('columns').action(async ({ host, out }) => {
        await out.render(null, reading('stdout'));
        await out.draw(null, reading('stderr'));
        await out.print(
          `host:${String(host.terminal.stdout.columns)},${String(host.terminal.stderr.columns)}`,
        );
      });
      const supplied = input.terminal;
      const columns = supplied?.stdout.columns;
      const oneScreen =
        typeof columns === 'number' &&
        columns === supplied.stderr.columns &&
        supplied.stdout.isTTY &&
        supplied.stderr.isTTY;
      const mock = createProcess({
        argv: [],
        env: input.env ?? fixtureOptions.env ?? {},
        ...(oneScreen ? { terminal: { columns, rows: 24 } } : {}),
      });
      /*
       * Distinct destination widths, widths retained on pipes, and unknown widths need a custom
       * ProcessTerminal, because mockProcess describes one screen with a known size. The composed
       * handle keeps the mock's recording streams and holds its own exit code, so the code the run
       * returns is the scenario's status.
       */
      fixture.exitCode = await app.run({
        process:
          supplied === undefined || oneScreen
            ? mock
            : processHandle({ ...mock, terminal: supplied }),
      });
    } else if (scenario === 'invoke') {
      // An invocation by name has no terminal, whatever COLUMNS the process holds.
      const app = new Application('columns', { description: 'Report columns.' }).command(
        new Command('show', { description: 'Show the columns.' }).action(async ({ out }) => {
          await out.render(null, reading('stdout'));
          await out.render(null, { render: (_value, context) => String(context.columns) });
        }),
      );
      const outcome = await app.invoke(['show'], {}, { process: createProcess() });
      writeStdout(JSON.stringify(outcome));
    } else if (scenario === 'fresh') {
      // A getter-backed host whose width the action changes between render calls.
      const mock = createProcess({
        argv: input.argv ?? [],
        env: scenario === 'draw' ? { COLUMNS: '60' } : {},
        record: scenario !== 'draw',
        terminal: { columns: 100, rows: 24 },
      });
      const at = (next) => {
        mock.resize(next, 24);
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
      fixture.exitCode = await app.run({
        process: mock,
      });
    } else if (scenario === 'failure') {
      // Core's default failure text on a narrow terminal, and an override that wraps its own text.
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
        )
        // A path inside nowrap, in an InputError's message and issue and in a FatalError's message.
        .command(
          new Command('reject', { description: 'Reject.' }).action(() => {
            const path = nowrap('/Users/a/Application Support/x.json');
            throw new InputError(`Option "--config": File "${path}" cannot be read.`, [
              {
                input: { global: false, kind: 'option', name: 'config' },
                issues: [{ message: `File "${path}" cannot be read.` }],
                reason: 'invalid',
                spelling: '--config',
              },
            ]);
          }),
        )
        .command(
          new Command('refuse', { description: 'Refuse.' }).action(({ out }) =>
            out.fatal(`${nowrap('/Users/a/Application Support/x.json')} cannot be read.`),
          ),
        );
      fixture.exitCode = await app.run({
        process: createProcess({
          argv: input.argv,
          env: {},
          release: { build: 'distributed' },
          terminal: {
            columns: 20,
            rows: 24,
            streams: (input.tty ?? true) ? ['stdout', 'stderr'] : [],
          },
        }),
      });
    } else if (scenario === 'draw') {
      // Out.draw counts rows against the real stderr width, never the COLUMNS-narrowed one.
      const mock = createProcess({
        argv: input.argv ?? [],
        env: scenario === 'draw' ? { COLUMNS: '60' } : {},
        record: scenario !== 'draw',
        terminal: { columns: 100, rows: 24 },
      });
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
          mock.resize(40, 24);
          counted.push(await out.draw(line, view));
        })
        .run({
          process: mock,
        });
      writeStdout(JSON.stringify({ counted, seen }));
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
