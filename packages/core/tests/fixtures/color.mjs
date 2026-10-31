import {
  Application,
  Command,
  DeclarationError,
  diagnosticRule,
  override,
  plugin,
  UsageError,
} from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { dotenv } from '@loomcli/plugins/dotenv';
import { loomTheme } from '@loomcli/plugins/theme';
import { z } from 'zod';

import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(fixtureWords, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: fixtureWords });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    /**
     * One run of a notes application that marks its own `--[no-]color`, `--[no-]colour` included, or
     * of the same application with the option unmarked. The first two fixture words name the variant and
     * terminal, `tty` or `pipe`, or `invoke` for an invocation by name, and the rest is the command line. `PROBE_CWD` names the working
     * directory a dotenv or configuration variant reads.
     */
    const [variant, terminal, ...argv] = fixtureWords;

    const terminals = { pipe: undefined, tty: { columns: 80, rows: 24 } };

    const notes = notesApplication(variant);
    const run = { 'run-always': { color: 'always' }, 'run-never': { color: 'never' } };

    const cwd = fixtureEnv.PROBE_CWD;
    // Capture variants leave the mock's default release facts in place.
    const capture = variant === 'capture' || variant === 'capture-unmarked';

    if (terminal === 'invoke') {
      // An invocation by name reads no choice, even when its values name the marked option.
      const outcome = await notes.invoke(
        ['save'],
        { options: { color: true } },
        { process: createProcess() },
      );
      writeStdout(JSON.stringify(outcome));
      (() => {
        throw fixture.stopped;
      })();
    }

    fixture.exitCode = await notes.run({
      process: createProcess({
        argv,
        ...(cwd === undefined ? {} : { cwd }),
        ...(capture
          ? {}
          : { release: { build: variant === 'graph' ? 'development' : 'distributed' } }),
        terminal: terminals[terminal],
      }),
      rendering: run[variant],
    });
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const configPlugin = (settings = {}) =>
  configuration({ ...settings, schema: z.record(z.string(), z.unknown()) }).plugin;
export { runFixture as run };

/** Builds the notes application shared by mock and bundled process runs. */
export function notesApplication(variant) {
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
    config: [configPlugin({ file: '.notes.json' })],
    dotenv: [dotenv({ only: ['NOTES_TOKEN'] })],
    graph: [judge],
  };

  const declared = { 'app-always': { color: 'always' }, 'app-never': { color: 'never' } };

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

  return app.command(
    new Command('save', { description: 'Save a note.' })
      .argument('words', { description: 'The words of the note.', variadic: true })
      .action(({ options, out, style }) => {
        out.info(style.bold(style.red('Saved.')));
        return out.print(JSON.stringify({ color: options.color }));
      }),
  );
}
