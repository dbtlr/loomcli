import { Application, Command, plugin } from '@loomcli/core';
import { format, json } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { mockProcess } from '@loomcli/testing';

import { recordLoads } from '../../../../scripts/record-loads.mjs';

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

  const table = { render: (data) => `table:${data.label}:${data.value}\n` };

  /** Every scenario installs the pack in the order the examples do, so help wins a tie. */
  const plugins = [help(), version(), format()];

  /** A plugin ahead of format() whose always-on middleware assigns a view of its own. */
  const earlier = plugin('@fixture/earlier', {
    middleware: {
      activate: 'always',
      load: () =>
        Promise.resolve({
          default: async (context) => {
            if (context.view !== null) {
              context.view = 'table';
            }
            await context.next();
          },
        }),
    },
  });

  const changeDefault = plugin('@fixture/default', {
    onCommandAttach: (command) =>
      command.result === null
        ? command
        : command.views({ custom: table, json: table }, { default: 'custom' }),
  });

  function hookOrder(before) {
    const count = new Command('count').result({ views: { table } }).action(dispatch);
    return new Application('app', {
      plugins: before ? [changeDefault, ...plugins] : [...plugins, changeDefault],
    }).command(count);
  }

  const scenarios = {
    /** An author-declared "json" view kept with its own map and its declared position. */
    'author-json': () => {
      const mapped = json({ map: (data) => ({ label: data.label }) });
      const count = new Command('count')
        .result({ views: { json: mapped, table } })
        .action(dispatch);
      return new Application('app', { plugins }).command(count).action(dispatch);
    },
    /** An author-declared "ndjson" key, so the alias no longer serves and names it directly. */
    'author-ndjson': () => {
      const count = new Command('count')
        .result({ views: { ndjson: table, table } })
        .action(dispatch);
      return new Application('app', { plugins }).command(count).action(dispatch);
    },
    'earlier-default': () => hookOrder(true),
    /** An earlier plugin assigns a view; an omitted --format leaves that assignment in place. */
    'earlier-view': () => {
      const count = new Command('count')
        .result({ views: { json: json(), table } })
        .action(dispatch);
      return new Application('app', { plugins: [earlier, ...plugins] })
        .command(count)
        .action(dispatch);
    },
    'later-default': () => hookOrder(false),
    'no-formatter': () =>
      new Application('app', { plugins: [help()] }).command(
        new Command('count').result({ views: { table } }).action(dispatch),
      ),
    /** A Command with no result, so --format is the unknown-option error and no help row. */
    'no-result': () => {
      const count = new Command('count').action(dispatch);
      return new Application('app', { plugins }).command(count).action(dispatch);
    },
    /** The formatter given the short spelling -f, so -f selects a view as --format does. */
    short: () => {
      const count = new Command('count').result({ views: { table } }).action(dispatch);
      return new Application('app', {
        plugins: [help(), version(), format({ short: 'f' })],
      }).command(count);
    },
  };

  await recordLoads();

  const [name, ...argv] = args;

  // "inspect <scenario>" prints the graph instead of running it, so a test reads the view names.
  if (name === 'inspect') {
    const [scenario] = argv;
    current.stdout.write(`${JSON.stringify(scenarios[scenario]().inspect())}\n`);
  } else {
    status = await scenarios[name]().run({
      process: capture({ argv }),
    });
  }
  return {
    status: current.exitCode ?? status,
    stderr: handles.map((handle) => handle.stderr.text).join(''),
    stdout: handles.map((handle) => handle.stdout.text).join(''),
  };
}

const dispatch = ({ out }) => out.results({ label: 'a', value: 1 });
export { run };
