import { Application, Command, processHandle } from '@loomcli/core';
import { configInput } from '@loomcli/plugins/config/extension';
import { help } from '@loomcli/plugins/help';
import { helpCommand, helpInput } from '@loomcli/plugins/help/extension';
import { loomTheme } from '@loomcli/plugins/theme';
import { version } from '@loomcli/plugins/version';

/**
 * One help page laid out against a fixed stdout width. The input is JSON in argv[2]:
 * { app, argv, columns, env?, rendering?, themed? }. `columns` is a number for a terminal that
 * wide, or null for a pipe. `app` declares the Application: its `name` and `config`, its `help`
 * extension value, its `options`, `arguments`, option `groups` as `{ kind, options }`, `stdin`, and
 * `commands`, where each child declares the same fields and an option's `help` is its help input
 * value.
 */
const input = JSON.parse(process.argv[2]);

/** The help extension a declared Command carries, when it declares one. */
function extensions(spec) {
  return spec.help === undefined ? [] : [helpCommand(spec.help)];
}

/** One option's configuration, with its help input value as an extension. */
function optionConfig({ configPath, help: shown, name: _name, ...config }) {
  const declared = [
    ...(configPath === undefined ? [] : [configInput({ path: configPath })]),
    ...(shown === undefined ? [] : [helpInput(shown)]),
  ];
  return declared.length === 0 ? config : { ...config, extensions: declared };
}

/** A Command with its declared options, arguments, children, and action. */
function declare(command, spec) {
  let declared = command;
  for (const option of spec.options ?? []) {
    declared = declared.option(option.name, optionConfig(option));
  }
  for (const { name, ...config } of spec.arguments ?? []) {
    declared = declared.argument(name, config);
  }
  for (const { kind, options } of spec.groups ?? []) {
    declared = declared[kind](...options);
  }
  if (spec.stdin !== undefined) {
    declared = declared.stdin(spec.stdin);
  }
  for (const child of spec.commands ?? []) {
    const config = { ...child.config, extensions: extensions(child) };
    declared = declared.command(declare(new Command(child.name, config), child));
  }
  return spec.action === false ? declared : declared.action(() => {});
}

const spec = input.app;
const plugins = [help(), version({ postfix: spec.postfix })];
if (input.themed) {
  plugins.push(loomTheme());
}
const app = declare(
  new Application(spec.name ?? 'app', {
    ...spec.config,
    extensions: extensions(spec),
    plugins,
  }),
  spec,
);
const width = input.columns;
await app.run({
  process: processHandle({
    argv: input.argv ?? ['--help'],
    env: input.env ?? {},
    platform: 'linux',
    terminal: {
      stderr: { isTTY: false },
      stdin: { isTTY: false },
      stdout: { columns: width ?? undefined, isTTY: width !== null, rows: 24 },
    },
  }),
  rendering: input.rendering ?? { color: 'never', hyperlinks: 'never', modifiers: 'never' },
});
