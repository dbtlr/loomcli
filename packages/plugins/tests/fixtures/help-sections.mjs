import { Application, Command, DeclarationError, plugin, readExtension } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import { loomTheme } from '@loomcli/plugins/theme';

const [scenario, ...argv] = process.argv.slice(2);

function metadata() {
  const app = new Application('sections', {
    extensions: [
      helpCommand({
        commandSections: [['Work', 'Read']],
        optionSections: [['Output']],
        section: [' Root ', 'Unused'],
      }),
    ],
  })
    .globalOption('quiet', {
      extensions: [helpInput({ section: ['Output', 'Logging'] })],
      type: 'boolean',
    })
    .action(() => {});
  const graph = app.inspect();
  const command = readExtension(graph.root, helpCommand);
  const input = readExtension(graph.globals[0], helpInput);
  process.stdout.write(
    `${JSON.stringify({
      command,
      frozen: [
        command,
        command.section,
        command.commandSections,
        command.commandSections?.[0],
        command.optionSections,
        command.optionSections?.[0],
        input,
        input.section,
      ].every(Object.isFrozen),
      input,
    })}\n`,
  );
}

function commands(includeDefault = true) {
  const next = new Command('next', {
    description: 'Find ready tasks.',
    extensions: [helpCommand({ section: ['Work commands', 'Read'] })],
  }).action(() => {});
  const done = new Command('done', {
    description: 'Complete a task.',
    extensions: [helpCommand({ section: ['Work commands', 'Lifecycle'] })],
  }).action(() => {});
  const doctor = new Command('doctor', { description: 'Check the application.' }).action(() => {});
  const app = new Application('work', {
    extensions: [
      helpCommand({
        commandSections: [['Work commands', 'Read'], ['Work commands', 'Lifecycle'], ['commands']],
        section: ['Ignored root membership'],
      }),
    ],
    plugins: [help()],
  })
    .command(done)
    .command(next)
    .command(
      new Command('hidden', {
        extensions: [helpCommand({ section: ['Invisible'] })],
        hidden: true,
      }).action(() => {}),
    );
  return includeDefault ? app.command(doctor) : app;
}

function options() {
  return new Application('report', {
    extensions: [
      helpCommand({
        optionSections: [['Output', 'Logging'], ['Output', 'Format'], ['options']],
      }),
    ],
    plugins: [help()],
  })
    .globalOption('quiet', {
      description: 'Suppress progress.',
      extensions: [helpInput({ section: ['output', 'format'] })],
      short: 'q',
      type: 'boolean',
    })
    .globalOption('log', {
      description: 'Print logs.',
      extensions: [helpInput({ section: ['Output', 'Logging'] })],
      short: 'l',
      type: 'boolean',
    })
    .argument('files', { description: 'Files to read.', required: true, variadic: true })
    .option('format', {
      description: 'Select the format.',
      extensions: [helpInput({ section: ['OUTPUT', 'FORMAT'] })],
      short: 'f',
      type: 'string',
    })
    .option('stream', {
      description: 'Stream results.',
      extensions: [helpInput({ section: ['Output'] })],
      type: 'boolean',
    })
    .option('strict', { description: 'Reject unreadable files.', type: 'boolean' })
    .action(() => {});
}

function sectionedCommand(name, section, description, hidden = false) {
  return new Command(name, {
    description,
    extensions: section === undefined ? [] : [helpCommand({ section })],
    hidden,
  }).action(() => {});
}

function ordered(parentOnly = false) {
  const contributed = plugin('@fixture/sections', {
    commands: [sectionedCommand('info', ['Machinery'], 'Inspect machinery.')],
  });
  return new Application('ordered', {
    extensions: [
      helpCommand({
        commandSections: [
          ...(parentOnly ? [['Work']] : []),
          ['Work', 'Archive'],
          ['Machinery'],
          ['Work', 'Read'],
          ['Extra'],
          ['Work', 'Lifecycle'],
          ['work', 'read'],
          ['Missing'],
        ],
      }),
    ],
    plugins: [help(), contributed],
  })
    .command(sectionedCommand('hidden', ['Zeta'], 'Never print this.', true))
    .command(sectionedCommand('doctor', undefined))
    .command(sectionedCommand('next', ['Work', 'Read'], 'Find tasks.'))
    .command(sectionedCommand('move', ['Work', 'Edit'], 'Move work.'))
    .command(sectionedCommand('done', ['Work', 'Lifecycle'], 'Finish work.'))
    .command(sectionedCommand('overview', ['work', 'read'], 'Project overview.'))
    .command(sectionedCommand('status', ['Work'], 'Show status.'))
    .command(sectionedCommand('archive', ['Work', 'Archive'], 'Never print this.', true))
    .command(sectionedCommand('extra', ['Extra'], 'More work.'))
    .command(sectionedCommand('alpha', ['Alpha']))
    .command(sectionedCommand('zeta', ['Zeta']));
}

function invalid() {
  const values = [[], ['One', 'Two', 'Three'], [1], [' '], ['One\nTwo'], 'One'];
  const rejected = [];
  for (const path of values) {
    for (const slot of ['command', 'local', 'global', 'plugin', 'commands', 'options']) {
      try {
        const value = helpInput({ section: path });
        let app = new Application('invalid');
        switch (slot) {
          case 'command': {
            app = app.extend(helpCommand({ section: path }));
            break;
          }
          case 'local': {
            app = app.option('quiet', { extensions: [value], type: 'boolean' });
            break;
          }
          case 'global': {
            app = app.globalOption('quiet', { extensions: [value], type: 'boolean' });
            break;
          }
          case 'plugin': {
            app = new Application('invalid', {
              plugins: [
                plugin('@fixture/invalid', {
                  options: { quiet: { extensions: [value], type: 'boolean' } },
                }),
              ],
            });
            break;
          }
          case 'commands': {
            app = app.extend(helpCommand({ commandSections: [path] }));
            break;
          }
          case 'options': {
            app = app.extend(helpCommand({ optionSections: [path] }));
            break;
          }
        }
        app.action(() => {}).inspect();
        rejected.push('accepted');
      } catch (error) {
        rejected.push(error instanceof DeclarationError ? error.rule.identity : 'wrong error');
      }
    }
  }
  process.stdout.write(`${JSON.stringify(rejected)}\n`);
}

function scoped() {
  const tracing = plugin('@fixture/tracing', {
    options: {
      trace: {
        description: 'Trace calls.',
        extensions: [helpInput({ section: ['Trace'] })],
        type: 'boolean',
      },
    },
  });
  const child = new Command('tools', {
    extensions: [
      helpCommand({
        optionSections: [['Global options'], ['Options']],
        section: ['Root commands'],
      }),
    ],
  })
    .argument('file', { description: 'File to read.', required: true })
    .option('mode', { description: 'Use mode.', type: 'boolean' })
    .action(() => {});
  return new Application('scoped', {
    extensions: [helpCommand({ optionSections: [['Trace'], ['Output'], ['Global options']] })],
    plugins: [help(), tracing],
  })
    .globalOption('quiet', {
      description: 'Say less.',
      extensions: [helpInput({ section: ['Output'] })],
      short: 'q',
      type: 'boolean',
    })
    .command(child);
}

function childOrder() {
  const parent = new Command('tools', {
    extensions: [
      helpCommand({ commandSections: [['Read'], ['Edit']], section: ['Outer', 'Ignored'] }),
    ],
  })
    .command(sectionedCommand('edit', ['Edit']))
    .command(sectionedCommand('read', ['Read']));
  return new Application('nested', {
    extensions: [helpCommand({ commandSections: [['Edit'], ['Read']] })],
    plugins: [help()],
  }).command(parent);
}

function wide() {
  return new Application('wide', { plugins: [help(), loomTheme()] })
    .option('field', {
      description: 'Fields.',
      extensions: [helpInput({ placeholder: '界界', section: ['out\uE001put', 'fi\uE002les'] })],
      short: 'F',
      type: 'string',
    })
    .option('mark', {
      description: 'Short.',
      extensions: [helpInput({ placeholder: 'é', section: ['OUT\uE001PUT', 'FI\uE002LES'] })],
      short: 'x',
      shortOnly: true,
      type: 'string',
    })
    .option('hidden-long-name', {
      extensions: [helpInput({ section: ['out\uE001put', 'fi\uE002les'] })],
      hidden: true,
      type: 'boolean',
    })
    .action(() => {});
}

function completing() {
  return new Application('project', {
    extensions: [helpCommand({ commandSections: [['Last'], ['First']] })],
    plugins: [help(), completion()],
  })
    .command(sectionedCommand('alpha', ['First'], 'Read first.'))
    .command(sectionedCommand('beta', ['Last'], 'Read last.'));
}

const scenarios = {
  'child-order': () => childOrder().run({ host: { argv, release: { build: 'distributed' } } }),
  commands: () => commands().run({ host: { argv, release: { build: 'distributed' } } }),
  completion: () => completing().run({ host: { argv, release: { build: 'distributed' } } }),
  graph: () => {
    process.stdout.write(
      `${JSON.stringify(
        ordered()
          .inspect()
          .root.children.map((child) => child.name),
      )}\n`,
    );
  },
  invalid,
  metadata,
  'named-only': () => commands(false).run({ host: { argv, release: { build: 'distributed' } } }),
  options: () => options().run({ host: { argv, release: { build: 'distributed' } } }),
  ordered: () => ordered().run({ host: { argv, release: { build: 'distributed' } } }),
  'parent-order': () => ordered(true).run({ host: { argv, release: { build: 'distributed' } } }),
  scoped: () => scoped().run({ host: { argv, release: { build: 'distributed' } } }),
  wide: () => wide().run({ host: { argv, release: { build: 'distributed' } } }),
  'wide-styled': () =>
    wide().run({
      host: { argv, env: {}, release: { build: 'distributed' } },
      rendering: { color: 'always', modifiers: 'always' },
    }),
};
await scenarios[scenario](argv);
