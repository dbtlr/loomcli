import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  override,
  plugin,
  UsageError,
} from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { dotenv } from '@loomcli/plugins/dotenv';
import { loomTheme } from '@loomcli/plugins/theme';

/**
 * One run of a notes application that marks its own `--[no-]color`, `--[no-]colour` included, or
 * of the same application with the option unmarked. argv[2] names the variant, argv[3] the
 * terminal, `tty` or `pipe`, or `invoke` for an invocation by name, and the rest is the command line. `PROBE_CWD` names the working
 * directory a dotenv or configuration variant reads.
 */
const [variant, terminal, ...argv] = process.argv.slice(2);

const terminals = {
  pipe: {
    stderr: { columns: undefined, isTTY: false, rows: undefined },
    stdin: { isTTY: false },
    stdout: { columns: undefined, isTTY: false, rows: undefined },
  },
  tty: {
    stderr: { columns: 80, isTTY: true, rows: 24 },
    stdin: { isTTY: false },
    stdout: { columns: 80, isTTY: true, rows: 24 },
  },
};

/** The application's own option, marked unless the variant leaves the mark out. */
const option = {
  aliases: ['colour'],
  control: true,
  description: 'Turn color on or off, overriding NO_COLOR.',
  polarity: 'both',
  type: 'boolean',
  ...(variant === 'unmarked' || variant === 'capture-unmarked' ? {} : { color: true }),
};

/** A usage failure's line, styled with a color and bold, so a case reads both from its bytes. */
const usageLine = {
  render: (failure, { style }) => `${style.bold(style.red(style.escape(failure.message)))}\n`,
};

const rejected = diagnosticRule('@fixture/judge/rejected', {
  explanation: 'The fixture judge rejects every graph.',
  headline: 'Rejected graph',
});

/** A plugin whose hook rejects every graph, a declaration error graph build raises. */
const judge = plugin('@fixture/judge', {
  onGraphBuilt: () => {
    throw new DeclarationError(rejected, {
      correction: 'Remove the judge.',
      sentence: 'The judge rejects the graph.',
    });
  },
});

const plugins = {
  config: [config({ file: '.notes.json' })],
  dotenv: [dotenv({ variables: ['NOTES_TOKEN'] })],
  graph: [judge],
};

const declared = { 'app-always': { color: 'always' }, 'app-never': { color: 'never' } };
const run = { 'run-always': { color: 'always' }, 'run-never': { color: 'never' } };

let app = new Application('notes', {
  description: 'Keep notes.',
  // The theme colors the lane glyphs and the Developer Diagnostic's banner, which core leaves plain.
  plugins: [loomTheme(), ...(plugins[variant] ?? [])],
  rendering: declared[variant],
  views: [override(UsageError, usageLine)],
}).globalOption('color', option);
if (variant === 'config') {
  app = app.globalOption('tint', {
    description: 'The tint of every note.',
    extensions: [configInput({ path: 'tint' })],
    type: 'string',
  });
}

const notes = app.command(
  new Command('save', { description: 'Save a note.' })
    .argument('words', { description: 'The words of the note.', variadic: true })
    .action(({ options, out, style }) => {
      out.info(style.bold(style.red('Saved.')));
      return out.print(JSON.stringify({ color: options.color }));
    }),
);

const cwd = process.env.PROBE_CWD;
// A capture case reads the process's own working directory and the facts its bundle bakes.
const capture = variant === 'capture' || variant === 'capture-unmarked';

if (terminal === 'invoke') {
  // An invocation by name reads no choice, even when its values name the marked option.
  const outcome = await notes.invoke(['save'], { options: { color: true } });
  process.stdout.write(JSON.stringify(outcome));
  process.exit(0);
}

process.exitCode = await notes.run({
  host: {
    argv,
    ...(cwd === undefined ? {} : { cwd }),
    ...(capture ? {} : { release: { build: variant === 'graph' ? 'development' : 'distributed' } }),
    terminal: terminals[terminal],
  },
  rendering: run[variant],
});
