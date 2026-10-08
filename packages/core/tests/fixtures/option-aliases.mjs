import { Application, Command, locate, plugin } from '@loomcli/core';

const [scenario, ...argv] = process.argv.slice(2);

/** A whole number, so a rejected value shows which spelling validation names. */
const digits = {
  '~standard': {
    validate: (value) =>
      /^[0-9]+$/u.test(value) ? { value } : { issues: [{ message: 'Use a whole number.' }] },
    vendor: 'probe',
    version: 1,
  },
};

/** Every action prints the path it ran on and the values it received. */
function report(command) {
  return ({ options, out }) => out.print(JSON.stringify({ command, options }));
}

/** A plugin whose global option keeps an old spelling as an alias. */
const trace = plugin('@fixture/trace', {
  options: { trace: { aliases: ['debug'], type: 'boolean' } },
});

/**
 * Options of every kind that each keep another name: a string option bound to a variable, a
 * Boolean option of each polarity, a multiple option, a global option, and a plugin's option.
 */
function sizes() {
  return new Application('sizes', { plugins: [trace] })
    .globalOption('file', { aliases: ['input'], type: 'string' })
    .option('min-bytes', {
      aliases: ['minimum', 'min'],
      env: 'SIZES_MIN_BYTES',
      type: 'string',
      validate: digits,
    })
    .option('color', { aliases: ['colour'], polarity: 'both', type: 'boolean' })
    .option('quiet', { aliases: ['silent'], polarity: 'negative', type: 'boolean' })
    .option('field', { aliases: ['column'], multiple: true, type: 'string' })
    .command(new Command('list').action(report(['list'])))
    .action(report([]));
}

/** The spellings one option node publishes, beside its declared aliases. */
const spellings = ({ aliases, long, name, negative, short }) => ({
  aliases,
  long,
  name,
  negative,
  short,
});

const scenarios = {
  inspect: () => {
    const { globals, root } = sizes().inspect();
    process.stdout.write(
      `${JSON.stringify({ globals: globals.map(spellings), options: root.options.map(spellings) })}\n`,
    );
  },
  locate: () => {
    const position = locate(sizes().inspect(), argv);
    process.stdout.write(
      `${JSON.stringify({ kind: position.kind, lead: position.lead, option: position.option?.name, prefix: position.prefix })}\n`,
    );
  },
  mutated: () => {
    const aliases = ['minimum'];
    const app = new Application('sizes')
      .option('min-bytes', { aliases, type: 'string' })
      .action(() => undefined);
    aliases.push('min');
    aliases[0] = 'smallest';
    const [option] = app.inspect().root.options;
    process.stdout.write(`${JSON.stringify(option?.aliases)}\n`);
  },
  run: async () => {
    process.exitCode = await sizes().run({ host: { argv, release: { build: 'distributed' } } });
  },
};

await scenarios[scenario]();
