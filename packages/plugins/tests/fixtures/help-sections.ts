import { Application, Command, plugin, readExtension } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import { loomTheme } from '@loomcli/plugins/theme';

import { runOnMock } from './in-process.ts';

type SectionPath = NonNullable<Parameters<typeof helpCommand>[0]['section']>;

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
  const global = graph.globals[0];
  if (global === undefined) {
    throw new Error('The fixture declares one global.');
  }
  const input = readExtension(global, helpInput);
  if (command === undefined || input === undefined) {
    throw new Error('The fixture declares help metadata.');
  }
  return {
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
  };
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
function sectionedCommand(
  name: string,
  section?: SectionPath,
  description?: string,
  hidden = false,
) {
  return new Command(name, {
    ...(description === undefined ? {} : { description }),
    extensions: section === undefined ? [] : [helpCommand({ section })],
    hidden,
  }).action(() => {});
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
function completing() {
  return new Application('project', {
    extensions: [helpCommand({ commandSections: [['Last'], ['First']] })],
    plugins: [help(), completion()],
  })
    .command(sectionedCommand('alpha', ['First'], 'Read first.'))
    .command(sectionedCommand('beta', ['Last'], 'Read last.'));
}

function ordered(parentOnly = false) {
  const contributed = plugin('@fixture/sections', {
    commands: [sectionedCommand('info', ['Machinery'], 'Inspect machinery.')],
  });
  return new Application('ordered', {
    extensions: [
      helpCommand({
        commandSections: [
          ...(parentOnly ? [['Work'] satisfies SectionPath] : []),
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

function graphOrder() {
  return ordered()
    .inspect()
    .root.children.map((child) => child.name);
}
async function run(args: string[] = []) {
  const [name, ...argv] = args;
  const scenarios = {
    'child-order': childOrder,
    commands,
    completion: completing,
    'named-only': () => commands(false),
    options,
    ordered,
    'parent-order': () => ordered(true),
    scoped,
    wide,
    'wide-styled': wide,
  };
  const factory = Object.entries(scenarios).find(([key]) => key === name)?.[1];
  if (factory === undefined) {
    throw new Error(`Unknown fixture scenario: ${name}`);
  }
  return await runOnMock(
    factory(),
    { argv },
    name === 'wide-styled' ? { rendering: { color: 'always', modifiers: 'always' } } : {},
  );
}
export { graphOrder, metadata, run };
