import { Application, Command, plugin } from '@loomcli/core';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout, stderr: writeStderr } = fixture;
  try {
    const [scenario, ...argv] = words;
    const [path] = argv;

    async function readHeader(source, mode) {
      const stream = source.stream();
      stream.on('error', (error) => {
        if (error.code !== 'ABORT_ERR') {
          writeStderr(`${error.message}\n`);
          fixture.exitCode = 1;
        }
      });
      if (mode === 'header-break') {
        for await (const chunk of stream) {
          return chunk;
        }
      } else {
        return await new Promise((resolve, reject) => {
          stream.once('error', reject);
          stream.once('data', (chunk) => {
            stream.destroy();
            resolve(chunk);
          });
        });
      }
    }

    if (['header-break', 'header-destroy'].includes(scenario)) {
      const app = new Application('content', {
        description: 'Read file headers and reopen sources.',
      })
        .argument('files', {
          description: 'The sources.',
          required: true,
          type: 'content',
          variadic: true,
        })
        .action(async ({ args, out }) => {
          await Promise.all(args.files.map((source) => readHeader(source, scenario)));
          const lengths = await Promise.all(
            args.files.map(async (source) => {
              const contents = await source.text();
              return contents.length;
            }),
          );
          await out.print(JSON.stringify(lengths));
        });
      const lengths = [];
      for (let index = 0; index < 100; index++) {
        const outcome = await app.invoke(
          [],
          { args: { files: argv } },
          { process: createProcess() },
        );
        if (outcome.status !== 'completed') {
          writeStderr(outcome.messages);
          fixture.exitCode = 1;
          break;
        }
        lengths.push(JSON.parse(outcome.output));
      }
      writeStdout(JSON.stringify(lengths));
    }

    if (scenario === 'hook-conflict') {
      try {
        const claim = plugin('@fixture/claim', {
          onCommandAttach: (command) =>
            command.name === 'cmd'
              ? command.option('other', {
                  description: 'The hook source.',
                  stdin: true,
                  type: 'content',
                })
              : command,
        });
        new Application('content', { description: 'Check hook claims.', plugins: [claim] })
          .command(
            new Command('cmd', { description: 'Own one source.' })
              .argument('file', { description: 'The source.', stdin: true, type: 'content' })
              .action(() => {}),
          )
          .inspect();
      } catch (error) {
        writeStdout(JSON.stringify({ findings: error.findings, rule: error.rule?.identity }));
      }
    }

    if (['stdin-group', 'named-conflict', 'mixed-conflict'].includes(scenario)) {
      try {
        if (scenario === 'stdin-group') {
          const group = new Command('group')
            .stdin({ description: 'An unused input.', required: true })
            .command(new Command('leaf').action(() => {}));
          new Application('content').command(group);
        } else {
          const command = new Command('cmd').argument('file', {
            description: 'The source.',
            stdin: true,
            type: 'content',
          });
          if (scenario === 'mixed-conflict') {
            command.stdin({ description: 'The second source.' });
          } else {
            command.option('other', {
              description: 'The second source.',
              stdin: true,
              type: 'content',
            });
          }
        }
        writeStdout(JSON.stringify({ accepted: true }));
      } catch (error) {
        writeStdout(
          JSON.stringify({
            findings: error.findings,
            name: error.name,
            rule: error.rule?.identity,
          }),
        );
      }
    }

    if (scenario === 'duplicate') {
      try {
        const config = { description: 'The source.', stdin: true, type: 'content' };
        new Application('content', { description: 'Check content declarations.' })
          .argument('file', config)
          .option('other', config);
        writeStdout(JSON.stringify({ accepted: true }));
      } catch (error) {
        writeStdout(JSON.stringify({ name: error.name, rule: error.rule?.identity }));
      }
    }

    if (['file'].includes(scenario)) {
      const app = fileApplication();
      const outcome = await app.invoke([], { args: { file: path } }, { process: createProcess() });
      writeStdout(JSON.stringify(outcome));
    }

    if (['collection', 'collection-max', 'terminal'].includes(scenario)) {
      const app = new Application('content', { description: 'Read content sources.' })
        .argument('files', {
          description: 'The sources to read.',
          required: true,
          stdin: true,
          type: 'content',
          variadic: true,
          ...(scenario === 'collection-max' ? { max: 1 } : {}),
        })
        .action(async ({ args, out }) => {
          const sources = [];
          for (const source of args.files) {
            sources.push({ kind: source.kind, name: source.name, text: await source.text() });
          }
          await out.print(JSON.stringify(sources));
        });
      await app.run({
        process: createProcess({
          argv,
          ...(scenario === 'terminal'
            ? {
                terminal: { columns: 80, keys: [], rows: 24, streams: [] },
              }
            : {}),
        }),
      });
    }

    if (['scalar', 'named-empty', 'named-dash'].includes(scenario)) {
      const app = scalarApplication();
      if (scenario === 'scalar') {
        await app.run({ process: createProcess({ argv }) });
      } else {
        const outcome = await app.invoke(
          [],
          { options: scenario === 'named-dash' ? { file: '-' } : {} },
          { process: createProcess() },
        );
        writeStdout(JSON.stringify(outcome));
      }
    }

    if (scenario === 'unread') {
      let reads = 0;
      const app = new Application('content', { description: 'Prepare sources without reading.' })
        .argument('files', {
          description: 'The sources.',
          required: true,
          stdin: true,
          type: 'content',
          variadic: true,
        })
        .option('name', { description: 'The name.', required: true, type: 'string' })
        .action(() => {
          throw new Error('The action must not run.');
        });
      const mock = createProcess({ argv: [], stdin: 'unread' });
      const read = mock.stdin.read.bind(mock.stdin);
      mock.stdin.read = (...args) => {
        reads++;
        return Reflect.apply(read, mock.stdin, args);
      };
      await app.run({ process: mock });
      writeStdout(JSON.stringify({ reads }));
    }

    if (scenario === 'stdin-order') {
      const app = new Application('content', { description: 'Report input problems in order.' })
        .option('unused', { description: 'An input that reports no problem.', type: 'boolean' })
        .stdin({ description: 'The input stream.', required: true })
        .option('name', { description: 'The name.', required: true, type: 'string' })
        .action(() => {});
      const outcome = await app.invoke(
        [],
        {},
        { failure: (failure) => failure.problems, process: createProcess() },
      );
      writeStdout(JSON.stringify(outcome));
    }

    if (['stdin', 'stdin-missing', 'stdin-help', 'stdin-help-optional'].includes(scenario)) {
      const { help } = await import('@loomcli/plugins/help');
      let app = new Application('content', { description: 'Read stdin.', plugins: [help()] }).stdin(
        {
          description: 'The event stream.',
          required: scenario !== 'stdin-help-optional',
        },
      );
      if (scenario === 'stdin-missing') {
        app = app.option('name', { description: 'The name.', required: true, type: 'string' });
      }
      await app
        .action(async ({ stdin, out }) => out.print(await stdin.text()))
        .run({
          process: createProcess({
            argv: scenario.startsWith('stdin-help') ? ['--help'] : argv,
            ...(scenario === 'stdin-missing'
              ? {
                  terminal: { columns: 80, keys: [], rows: 24, streams: [] },
                }
              : {}),
          }),
        });
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };

/** Builds the named-file application shared by mock and real stdin tests. */
export function fileApplication() {
  return new Application('content', { description: 'Read one content source.' })
    .argument('file', { description: 'The source to read.', required: true, type: 'content' })
    .action(async ({ args, out }) => {
      const source = args.file;
      await out.print(
        JSON.stringify({
          kind: source.kind,
          name: source.name,
          path: source.path,
          text: await source.text(),
        }),
      );
    });
}

/** Builds the scalar source application shared by mock and shell transport tests. */
export function scalarApplication() {
  return new Application('content', { description: 'Read one source.' })
    .option('file', {
      description: 'The source.',
      required: true,
      stdin: true,
      type: 'content',
    })
    .action(async ({ options, out }) => out.print(await options.file.text()));
}
