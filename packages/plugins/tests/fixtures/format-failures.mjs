import { Application, Command, FatalError } from '@loomcli/core';
import { format, json } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  let status = 0;
  const output = mockProcess({ env });
  const handles = [output];
  let captured = output;
  const capture = (fields) => {
    const { terminal, ...facts } = fields;
    const handle = mockProcess({
      env,
      ...facts,
      ...(terminal !== undefined
        ? {
            terminal: {
              columns: terminal.stdout?.columns ?? terminal.stderr?.columns,
              rows: 24,
              streams: ['stdout', 'stderr'].filter((name) => terminal[name]?.isTTY),
              ...(terminal.background === undefined ? {} : { background: terminal.background }),
            },
          }
        : {}),
    });
    handles.push(handle);
    captured = handle;
    return handle;
  };

  /** A validator that accepts decimal digits alone. */
  const digits = {
    '~standard': {
      validate: (value) =>
        /^\d+$/u.test(value) ? { value } : { issues: [{ message: 'Use decimal digits.' }] },
      vendor: 'fixture',
      version: 1,
    },
  };

  const table = { render: (data) => `table:${data.label}\n` };

  /** Every scenario installs the pack in the order the examples do. */
  const plugins = [help(), version(), format()];

  /** A Command that fails as `--fail` names, after its own options validated. */
  const count = new Command('count')
    .option('depth', { type: 'string', validate: digits })
    .option('fail', { type: 'string' })
    .result({ views: { table } })
    .action(({ options, out }) => {
      if (options.fail === 'controls') {
        throw new FatalError('A \u009b control and a "quote".');
      }
      if (options.fail !== undefined) {
        throw new FatalError('The count failed.');
      }
      return out.results({ label: 'a' });
    });

  const scenarios = {
    /** A Command whose default view is `json()`, so a failure with no --format encodes. */
    'json-default': () =>
      new Application('app', { plugins }).command(
        new Command('count').result({ views: { json: json(), table } }).action(() => {
          throw new FatalError('The count failed.');
        }),
      ),
    plain: () => new Application('app', { plugins }).command(count),
    /** Terminal controls preserved, so a C1 control reaches the encoder, which escapes it. */
    preserve: () =>
      new Application('app', { plugins, rendering: { terminalControls: 'preserve' } }).command(
        count,
      ),
  };

  const [name, ...argv] = args;

  status = await scenarios[name]().run({
    process: capture({ argv }),
  });
  return {
    status: captured.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
