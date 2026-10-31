import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

import { ruleText } from '../rule-text.mjs';
import { scenario as fixtureScenario } from '../scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, stdout: writeStdout } = fixture;

  function declare(build) {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`thrown:${error.exitCode}: ${ruleText(error)}\n`);
      throw fixture.stopped;
    }
  }
  try {
    /** Each Command prints its own name, so a run shows which Command routing selected. */

    const doctor = named('doctor');

    /** A group whose one child a run reaches through the group's name. */
    const tools = new Command('tools').command(named('clear'));

    /** A hook that declares a local option on the Command named doctor, which a plugin attaches. */
    const quiet = plugin('@acme/quiet', {
      onCommandAttach: (command) =>
        command.name === 'doctor' ? command.option('quiet', { type: 'boolean' }) : command,
    });

    /** A plugin that attaches the Commands it is given, under one identity. */

    const scenarios = {
      'alias-collision': () =>
        new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] }).command(
          new Command('check').alias('doctor').action(({ out }) => out.print('ran:check')),
        ),
      'application-collision': () =>
        new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] }).command(
          named('doctor'),
        ),
      // The application's own command() closes globalOption(), whatever the plugins attached.
      'global-after-plugin-commands': () =>
        new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] })
          .globalOption('file', { type: 'string' })
          .command(named('local')),
      // A plugin Command's local option is judged against the globals when globalOption() is called.
      'global-collision': () =>
        new Application('app', {
          plugins: [
            attaching('@acme/doctor', [
              new Command('doctor')
                .option('quiet', { type: 'boolean' })
                .action(({ out }) => out.print('ran')),
            ]),
          ],
        })
          .globalOption('quiet', { type: 'boolean' })
          .command(named('local')),
      // The hook belongs to a plugin other than the one that attaches the Command.
      hooked: () =>
        new Application('app', {
          plugins: [
            quiet,
            attaching('@acme/doctor', [
              new Command('doctor').action(({ options, out }) =>
                out.print(`quiet:${String(options.quiet)}`),
              ),
            ]),
          ],
        }).command(named('local')),
      // A group a plugin attaches routes into its own children like any other group.
      nested: () =>
        new Application('app', {
          plugins: [attaching('@acme/tools', [tools])],
        }).command(named('local')),
      // Two plugins and the application each attach, so the root's order is visible end to end.
      order: () =>
        new Application('app', {
          plugins: [
            attaching('@acme/first', [named('alpha'), named('beta')]),
            attaching('@acme/second', [named('gamma')]),
          ],
        }).command(named('local')),
      // One plugin's hook runs over the Command the same plugin attaches.
      'own-hook': () =>
        new Application('app', {
          plugins: [
            plugin('@acme/doctor', {
              commands: [
                new Command('doctor').action(({ options, out }) =>
                  out.print(`quiet:${String(options.quiet)}`),
                ),
              ],
              onCommandAttach: (command) =>
                command.name === 'doctor' ? command.option('quiet', { type: 'boolean' }) : command,
            }),
          ],
        }).command(named('local')),
      'plugin-collision': () =>
        new Application('app', {
          plugins: [
            attaching('@acme/doctor', [doctor]),
            attaching('@acme/clinic', [named('doctor')]),
          ],
        }).command(named('local')),
      'plugin-repeated-name': () => attaching('@acme/doctor', [named('doctor'), named('doctor')]),
      'plugin-unfinished': () => attaching('@acme/doctor', [new Command('doctor')]),
      'root-arguments': () =>
        new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] })
          .argument('files', { variadic: true })
          .action(({ out }) => out.print('ran:root')),
      'same-value-at-root': () =>
        new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] }).command(doctor),
      // Two plugins list one Command value, which the root would then attach twice.
      'same-value-in-plugins': () =>
        new Application('app', {
          plugins: [attaching('@acme/doctor', [doctor]), attaching('@acme/clinic', [doctor])],
        }).command(named('local')),
      'same-value-nested': () =>
        new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] }).command(
          new Command('tools').command(doctor),
        ),
    };

    const app = declare(scenarios[fixtureWords[0]]);
    const mode = fixtureWords[1];

    if (mode === 'inspect') {
      try {
        const graph = app.inspect();
        writeStdout(`${JSON.stringify(graph.root.children.map((child) => child.name))}\n`);
      } catch (error) {
        const kind = error instanceof DeclarationError ? 'declaration' : 'other';
        writeStdout(`${kind}:${error.exitCode}: ${error.sentence ?? error.message}\n`);
      }
    } else {
      const code = await app.run({
        process: createProcess({ argv: fixtureWords.slice(2) }),
      });
      writeStdout(`resolved:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const named = (name) => new Command(name).action(({ out }) => out.print(`ran:${name}`));
const attaching = (identity, commands) => plugin(identity, { commands });

export { runFixture as run };
