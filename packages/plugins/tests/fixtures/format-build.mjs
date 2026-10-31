import { Application, Command, plugin } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  let status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  let current = output;
  const capture = (fields) => {
    const { terminal, ...facts } = fields;
    const handle = mockProcess({
      env,
      ...facts,
      ...(terminal?.stdout?.isTTY || terminal?.stderr?.isTTY
        ? {
            terminal: {
              columns: terminal.stdout?.columns ?? terminal.stderr?.columns,
              rows: 24,
              streams: [terminal.stdout?.isTTY ? 'stdout' : 'stderr'],
              ...(terminal.background === undefined ? {} : { background: terminal.background }),
            },
          }
        : {}),
    });
    handles.push(handle);
    current = handle;
    return handle;
  };

  const table = { render: () => 'table\n' };

  /** A Command whose result carries one view, so the hook has something to reshape. */
  function withResult(command) {
    return command.result({ views: { table } });
  }

  /** A plugin whose own option is named "format", installed ahead of format() in every scenario. */
  const claimant = plugin('@fixture/claimant', {
    options: { format: { description: 'Claim the name first.', type: 'boolean' } },
  });

  const scenarios = {
    /** A global option "format" on the Application, which every Command's hook sees. */
    'global-collision': () => {
      const count = withResult(new Command('count')).action(dispatch);
      return new Application('app', { plugins: [format()] })
        .globalOption('format', { type: 'boolean' })
        .command(count)
        .action(dispatch);
    },
    /** A local option "format" on the Command the hook would otherwise reshape. */
    'local-collision': () => {
      const count = withResult(new Command('count').option('format', { type: 'boolean' })).action(
        dispatch,
      );
      return new Application('app', { plugins: [format()] }).command(count).action(dispatch);
    },
    /** Another plugin's own option "format", installed ahead of format(). */
    'plugin-collision': () => {
      const count = withResult(new Command('count')).action(dispatch);
      return new Application('app', { plugins: [claimant, format()] })
        .command(count)
        .action(dispatch);
    },
    /** The short spelling -h, which help() installed ahead of format() already claims. */
    'short-help-collision': () => {
      const count = withResult(new Command('count')).action(dispatch);
      return new Application('app', { plugins: [help(), format({ short: 'h' })] }).command(count);
    },
    /** The short spelling -f, which the Command's own --file already claims. */
    'short-local-collision': () => {
      const count = withResult(
        new Command('count').option('file', { short: 'f', type: 'string' }),
      ).action(dispatch);
      return new Application('app', { plugins: [format({ short: 'f' })] }).command(count);
    },
  };

  const [name, ...argv] = args;

  // "inspect <scenario>" prints the rule, sentence, and finding notes of the fault inspect() throws.
  if (name === 'inspect') {
    try {
      scenarios[argv[0]]().inspect();
    } catch (error) {
      const { findings, rule, sentence } = error;
      const notes = findings.map((finding) => finding.note);
      current.stdout.write(`${JSON.stringify({ notes, rule: rule?.identity, sentence })}\n`);
    }
  } else {
    status = await scenarios[name]().run({
      process: capture({ argv, release: { build: 'distributed' } }),
    });
  }
  return {
    status: current.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

const dispatch = ({ out }) => out.print('dispatched');
export { run };
