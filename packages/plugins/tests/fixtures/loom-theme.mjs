import { Application, DeclarationError, plugin, style } from '@loomcli/core';
import { loomTheme, theme } from '@loomcli/plugins/theme';
import { mockProcess } from '@loomcli/testing';

/** Runs the fixture on isolated process facts and returns its recorded output. */
async function run(args = [], env = {}) {
  const status = 0;
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

  const input = JSON.parse(args[0]);

  const overrides =
    input.overrides &&
    Object.fromEntries(
      Object.entries(input.overrides).map(([name, chain]) => [
        name,
        chain === null
          ? undefined
          : chain.reduce(
              (current, step) =>
                Array.isArray(step) ? current[step[0]](...step.slice(1)) : current[step],
              style,
            ),
      ]),
    );

  let plugins = [loomTheme(overrides)];

  if (input.bare) {
    plugins = [theme({})];
  }

  if (input.absent) {
    plugins = [];
  }

  if (input.collision === 'identity') {
    plugins.push(theme({}));
  }

  if (input.collision === 'slot') {
    plugins.push(plugin('another', { theme: {} }));
  }

  try {
    const app = new Application('palette', { plugins }).action(({ out, style: contextual }) => {
      const tokens = input.tokens ?? [
        'primary',
        'dim',
        'highlight',
        'success',
        'warning',
        'error',
        'info',
      ];
      let text = tokens.map((name) => contextual[name](name)).join('|');
      if (input.literal) {
        text = input.literal;
      }
      if (input.outer) {
        text = style.red.bgBlue.bold(text);
      }
      out.render(text, { render: (value) => value });
    });

    await app.run({
      process: capture({
        argv: [],
        env: input.env ?? {},
        terminal: {
          stderr: { isTTY: false },
          stdin: { isTTY: false },
          stdout: { isTTY: input.tty ?? false },
          ...(input.background === undefined ? {} : { background: input.background }),
        },
      }),
      rendering: input.rendering,
    });
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    return { status: 1, stderr: error.message, stdout: '' };
  }
  return {
    status: captured.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

export { run };
