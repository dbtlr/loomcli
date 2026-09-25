import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

/** Each Command prints its own name, so a run shows which Command routing selected. */
const named = (name) => new Command(name).action(({ out }) => out.print(`ran:${name}`));

const doctor = named('doctor');

/** A group whose one child a run reaches through the group's name. */
const tools = new Command('tools').command(named('clear'));

/** A hook that declares a local option on the Command named doctor, which a plugin attaches. */
const quiet = plugin('@acme/quiet', {
  onCommandAttach: (command) =>
    command.name === 'doctor' ? command.option('quiet', { type: 'boolean' }) : command,
});

/** A plugin that attaches the Commands it is given, under one identity. */
const attaching = (identity, commands) => plugin(identity, { commands });

const scenarios = {
  'alias-collision': () =>
    new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] }).command(
      new Command('check').alias('doctor').action(({ out }) => out.print('ran:check')),
    ),
  'application-collision': () =>
    new Application('app', { plugins: [attaching('@acme/doctor', [doctor])] }).command(
      named('doctor'),
    ),
  // A plugin Command's local option is judged against the application's globals at build.
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
      plugins: [attaching('@acme/doctor', [doctor]), attaching('@acme/clinic', [named('doctor')])],
    }).command(named('local')),
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

const build = scenarios[process.argv[2]];
const mode = process.argv[3];

if (mode === 'inspect') {
  try {
    const graph = build().inspect();
    process.stdout.write(`${JSON.stringify(graph.root.children.map((child) => child.name))}\n`);
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'declaration' : 'other';
    process.stdout.write(`${kind}:${error.exitCode}: ${error.message}\n`);
  }
} else {
  const code = await build().run({ host: { argv: process.argv.slice(4) } });
  process.stdout.write(`resolved:${code}\n`);
}
