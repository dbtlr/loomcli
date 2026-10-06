import { Application, Command, plugin } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { config } from '@loomcli/plugins/config';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { manifest } from '@loomcli/plugins/manifest';
import { suggestions } from '@loomcli/plugins/suggestions';
import { loomTheme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';

const [scenario, build, ...argv] = process.argv.slice(2);

/** Hook calls, so a scenario reports whether a hook ran. */
const judged = [];

/** A plugin Command whose argument carries no description, and a plugin option with none. */
const doctor = plugin('@acme/doctor', {
  commands: [
    new Command('doctor', { description: 'Check the setup.' })
      .argument('target', {})
      .action(({ out }) => out.print('checked')),
  ],
  options: { trace: { type: 'boolean' } },
});

/** A hook that declares an undescribed option on `get`, and judges the built graph. */
const tagger = plugin('@acme/tag', {
  onCommandAttach: (command) =>
    command.name === 'get' ? command.option('tag', { type: 'string' }) : command,
  onGraphBuilt: () => {
    judged.push('judged');
  },
});

/**
 * Seven gaps: the root, a hidden Command, a deprecated option, a global option, a plugin's option,
 * a plugin Command's argument, and an option a hook declares.
 */
function gaps() {
  return new Application('store', {
    packet: { build },
    plugins: [help(), completion(), doctor, tagger],
  })
    .globalOption('verbose', { type: 'boolean' })
    .command(
      new Command('get', { description: 'Read one value.' })
        .argument('path', { description: 'The path to read.', required: true })
        .option('raw', { deprecated: 'Use --plain instead.', type: 'boolean' })
        .action(({ args, out }) => out.print(args.path)),
    )
    .command(new Command('purge', { hidden: true }).action(({ out }) => out.print('purged')));
}

/** Every Command and input described, every first-party plugin's included. */
function described() {
  return new Application('store', {
    description: 'Read stored values.',
    packet: { build },
    plugins: [
      help(),
      version(),
      completion(),
      manifest(),
      format(),
      config(),
      suggestions(),
      loomTheme(),
    ],
  })
    .globalOption('verbose', { description: 'Print more.', type: 'boolean' })
    .command(
      new Command('get', { description: 'Read one value.' })
        .argument('path', { description: 'The path to read.', required: true })
        .action(({ args, out }) => out.print(args.path)),
    )
    .command(
      new Command('list', { description: 'List the stored keys.' })
        .result({ views: { text: { render: () => 'listed\n' } } })
        .action(({ out }) => out.results('name')),
    );
}

/** A plugin's own Command and a Command nested under a group, each without a description. */
function nested() {
  const probe = plugin('@acme/probe', {
    commands: [new Command('probe').action(({ out }) => out.print('probed'))],
  });
  return new Application('store', {
    description: 'Read stored values.',
    packet: { build },
    plugins: [probe],
  }).command(
    new Command('config', { description: 'Manage settings.' }).command(
      new Command('set').action(({ out }) => out.print('set')),
    ),
  );
}

/** One gap alone. */
function single() {
  return new Application('store', { packet: { build } }).action(({ out }) => out.print('ran'));
}

if (scenario === 'nested' || scenario === 'single') {
  const app = scenario === 'nested' ? nested() : single();
  const code = await app.run({ host: { argv } });
  process.stdout.write(`resolved:${code}\n`);
} else if (scenario === 'run') {
  const code = await gaps().run({ host: { argv } });
  process.stdout.write(`resolved:${code} judged:${judged.length}\n`);
} else if (scenario === 'described') {
  const code = await described().run({ host: { argv } });
  process.stdout.write(`resolved:${code}\n`);
} else if (scenario === 'doors') {
  const app = gaps();
  const outcome = await app.invoke(['get'], { args: { path: 'name' } });
  const judgedByInvoke = judged.length;
  const inspected = app.inspect();
  process.stdout.write(
    `${JSON.stringify({
      exitCode: outcome.exitCode,
      failure: outcome.failure?.name,
      inspected: inspected.name,
      judged: judgedByInvoke,
      rule: outcome.failure?.rule?.identity,
      status: outcome.status,
    })}\n`,
  );
}
