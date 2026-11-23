import { Application, Command, plugin } from '@loomcli/core';
import { loomTheme } from '@loomcli/plugins/theme';

import { scenario as fixtureScenario } from './scenario.mjs';

/**
 * One run of a notes application that marks its own `-v, --verbose` and `-q, --quiet` and logs
 * through message templates. argv[0] names the variant: `plain` installs no plugin, `hooked` an
 * `onLog` hook that records each event's level and message, and `themed` the Loom theme. argv[1]
 * names the terminal, `tty` or `pipe`, or `invoke` for an invocation by name whose option values
 * argv[2] holds as JSON, and the rest is the command line.
 */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;
  try {
    const [variant, terminal, ...argv] = fixtureWords;
    const heard = [];
    const plugins = {
      errors: [
        plugin('@fixture/errors', {
          onLog: (event) => {
            heard.push(event.fields);
          },
        }),
      ],
      hooked: [
        plugin('@fixture/heard', {
          onLog: (event) => {
            heard.push(`${event.level} ${event.message}`);
          },
        }),
      ],
      themed: [loomTheme()],
    };
    let reads = 0;
    const notes = new Application('notes', { plugins: plugins[variant] ?? [] })
      .globalOption('verbose', {
        description: 'Show more detail.',
        short: 'v',
        type: 'count',
        verbose: true,
      })
      .globalOption('quiet', { description: 'Show less.', quiet: true, short: 'q', type: 'count' })
      .command(
        new Command('index', { description: 'Index notes.' }).action(async ({ log, out }) => {
          log.trace('Looked in {dir}.', { dir: '/etc' });
          log.debug('Read {file} in {ms} ms.', {
            count: 3,
            extra: 'x y',
            file: '/srv/a b.json',
            ms: 12,
          });
          log.info('Indexed {{sessions}} for {harness} {missing}.', {
            harness: 'claude',
            when: 'now',
          });
          log.warn('Skipped a line.', { line: 'a\u0007b', note: '' });
          log.error('Gave up.', { cause: { code: 'E' }, tries: [1, 2] });
          await out.warn('warned');
        }),
      )
      .command(
        new Command('sentence', { description: 'Log a sentence.' }).action(({ log }) => {
          log.debug('Ignored {key}: {issue}', {
            issue: 'Choose a number between one and ten.',
            key: 'port',
          });
        }),
      )
      .command(
        new Command('errors', { description: 'Log an error.' }).action(({ log }) => {
          const error = new Error('bad\n[red]value', { cause: new Error('hidden cause') });
          error.stack = 'hidden stack';
          log.debug('Placed {error}.', { error });
          log.debug('Trailing.', { error });
        }),
      )
      .command(
        new Command('fail', { description: 'Fail.' }).action(({ log, out }) => {
          log.debug('Before {step}.', { step: 'fail' });
          return out.fatal('It failed.');
        }),
      )
      .command(
        new Command('counted', { description: 'Count field reads.' }).action(
          async ({ log, out }) => {
            log.debug('Counted.', {
              get value() {
                reads += 1;
                return 1;
              },
            });
            await out.print(`reads ${String(reads)}`);
          },
        ),
      )
      .command(
        new Command('nested', { description: 'Index by name.' }).action(async ({ invoke, out }) => {
          const outcome = await invoke(['index'], {});
          await out.print(JSON.stringify(outcome.messages));
        }),
      );

    if (terminal === 'invoke') {
      const [values] = argv;
      const outcome = await notes.invoke(
        ['index'],
        { options: JSON.parse(values ?? '{}') },
        { process: createProcess() },
      );
      writeStdout(JSON.stringify({ messages: outcome.messages, status: outcome.status }));
      (() => {
        throw fixture.stopped;
      })();
    }

    fixture.exitCode = await notes.run({
      process: createProcess({
        argv,
        release: { build: 'distributed' },
        terminal:
          terminal === 'tty' ? { columns: variant === 'narrow' ? 24 : 80, rows: 24 } : undefined,
      }),
    });
    if (variant === 'hooked' || variant === 'errors') {
      writeStdout(`heard ${JSON.stringify(heard)}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

export { runFixture as run };
