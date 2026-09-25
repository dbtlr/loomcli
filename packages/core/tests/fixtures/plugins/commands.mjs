import { Application, Command, DeclarationError, plugin } from '@loomcli/core';

/** Each Command prints its own name, so a run shows which Command routing selected. */
const named = (name) => new Command(name).action(({ out }) => out.print(`ran:${name}`));

const doctor = named('doctor');

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
  // The hook plugin installs first, so its hook runs over a Command a later plugin attaches.
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
  // Two plugins and the application each attach, so the root's order is visible end to end.
  order: () =>
    new Application('app', {
      plugins: [
        attaching('@acme/first', [named('alpha'), named('beta')]),
        attaching('@acme/second', [named('gamma')]),
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
