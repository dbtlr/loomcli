import { execFileSync } from 'node:child_process';
import { closeSync } from 'node:fs';
import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';
import { fileURLToPath } from 'node:url';

import { Application, Command, plugin, processHandle } from '@loomcli/core';

import { fixtureHome } from '../../../../scripts/fixture-home.mjs';

const [scenario, ...argv] = process.argv.slice(2);
const [path] = argv;

if (scenario === 'named-pipe') {
  process.stdout.write(
    execFileSync(
      'sh',
      [
        '-c',
        String.raw`printf "transport sentinel\n" | "$@"`,
        'content-input',
        process.execPath,
        fileURLToPath(import.meta.url),
        'named-file-unread',
        path,
      ],
      { encoding: 'utf8', timeout: 5000 },
    ),
  );
}

if (['named-redirected', 'named-fifo', 'argv-pipe', 'argv-substitution'].includes(scenario)) {
  const scripts = {
    'argv-pipe': String.raw`printf "transport sentinel\n" | "$@"`,
    'argv-substitution': String.raw`"$@" <(printf "source sentinel\n")`,
    'named-fifo': String.raw`mkfifo "$1"; fifo=$1; shift; printf "source sentinel\n" > "$fifo" & exec "$@"`,
    'named-redirected': 'source=$1; shift; exec "$@" < "$source"',
  };
  const named = scenario.startsWith('named-');
  process.stdout.write(
    execFileSync(
      scenario === 'argv-substitution' ? 'bash' : 'sh',
      [
        '-c',
        scripts[scenario],
        'content-input',
        ...(named ? [path] : []),
        process.execPath,
        fileURLToPath(import.meta.url),
        named ? 'named-file-unread' : 'scalar',
        ...(named ? [path] : ['--file', ...(path === undefined ? [] : [path])]),
      ],
      { encoding: 'utf8', timeout: 5000 },
    ),
  );
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
    process.stdout.write(JSON.stringify({ findings: error.findings, rule: error.rule?.identity }));
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
    process.stdout.write(JSON.stringify({ accepted: true }));
  } catch (error) {
    process.stdout.write(
      JSON.stringify({ findings: error.findings, name: error.name, rule: error.rule?.identity }),
    );
  }
}

if (scenario === 'duplicate') {
  try {
    const config = { description: 'The source.', stdin: true, type: 'content' };
    new Application('content', { description: 'Check content declarations.' })
      .argument('file', config)
      .option('other', config);
    process.stdout.write(JSON.stringify({ accepted: true }));
  } catch (error) {
    process.stdout.write(JSON.stringify({ name: error.name, rule: error.rule?.identity }));
  }
}

if (['file', 'named-file-unread', 'file-closed-stdin'].includes(scenario)) {
  if (scenario === 'file-closed-stdin') {
    closeSync(0);
  }
  const app = new Application('content', { description: 'Read one content source.' })
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
  const outcome = await app.invoke([], { args: { file: path } });
  process.stdout.write(
    JSON.stringify(
      scenario === 'named-file-unread'
        ? { outcome, remaining: await text(process.stdin) }
        : outcome,
    ),
  );
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
    process: processHandle({
      argv,
      home: fixtureHome(),
      ...(scenario === 'terminal'
        ? {
            terminal: {
              stderr: { isTTY: false },
              stdin: { isTTY: true },
              stdout: { isTTY: false },
            },
          }
        : {}),
    }),
  });
}

if (['scalar', 'named-empty', 'named-dash'].includes(scenario)) {
  const app = new Application('content', { description: 'Read one source.' })
    .option('file', { description: 'The source.', required: true, stdin: true, type: 'content' })
    .action(async ({ options, out }) => out.print(await options.file.text()));
  if (scenario === 'scalar') {
    await app.run({ process: processHandle({ argv, home: fixtureHome() }) });
  } else {
    process.stdout.write(
      JSON.stringify(
        await app.invoke([], { options: scenario === 'named-dash' ? { file: '-' } : {} }),
      ),
    );
  }
}

if (scenario === 'unread') {
  let reads = 0;
  const stdin = new Readable({
    read() {
      reads++;
    },
  });
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
  await app.run({ process: processHandle({ argv: [], home: fixtureHome(), stdin }) });
  process.stdout.write(JSON.stringify({ reads }));
}

if (scenario === 'stdin-order') {
  const app = new Application('content', { description: 'Report input problems in order.' })
    .option('unused', { description: 'An input that reports no problem.', type: 'boolean' })
    .stdin({ description: 'The input stream.', required: true })
    .option('name', { description: 'The name.', required: true, type: 'string' })
    .action(() => {});
  process.stdout.write(
    JSON.stringify(await app.invoke([], {}, { failure: (failure) => failure.problems })),
  );
}

if (['stdin', 'stdin-missing', 'stdin-help', 'stdin-help-optional'].includes(scenario)) {
  const { help } = await import('@loomcli/plugins/help');
  let app = new Application('content', { description: 'Read stdin.', plugins: [help()] }).stdin({
    description: 'The event stream.',
    required: scenario !== 'stdin-help-optional',
  });
  if (scenario === 'stdin-missing') {
    app = app.option('name', { description: 'The name.', required: true, type: 'string' });
  }
  await app
    .action(async ({ stdin, out }) => out.print(await stdin.text()))
    .run({
      process: processHandle({
        argv: scenario.startsWith('stdin-help') ? ['--help'] : argv,
        home: fixtureHome(),
        ...(scenario === 'stdin-missing'
          ? {
              terminal: {
                stderr: { isTTY: false },
                stdin: { isTTY: true },
                stdout: { isTTY: false },
              },
            }
          : {}),
      }),
    });
}
