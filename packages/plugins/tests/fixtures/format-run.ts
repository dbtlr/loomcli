import { Application, Command, plugin } from '@loomcli/core';
import type { MiddlewareContext, View } from '@loomcli/core';
import { format, json } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { z } from 'zod';

import { runOnMock } from './in-process.ts';

/** Runs the fixture on isolated process facts and returns its recorded output. */
function fixtureApplication(name: string) {
  const table: View<unknown> = {
    render: (data) => {
      const row = z.object({ label: z.string(), value: z.number() }).parse(data);
      return `table:${row.label}:${row.value}\n`;
    },
  };

  /** Every scenario installs the pack in the order the examples do, so help wins a tie. */
  const plugins = [help(), version(), format()];

  /** A plugin ahead of format() whose always-on middleware assigns a view of its own. */
  const earlier = plugin('@fixture/earlier', {
    middleware: {
      activate: 'always',
      load: () =>
        Promise.resolve({
          default: async (context: MiddlewareContext) => {
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

  function hookOrder(before: boolean) {
    const count = new Command('count')
      .result({ views: { table } })
      .action(({ out }) => out.results({ label: 'a', value: 1 }));
    return new Application('app', {
      plugins: before ? [changeDefault, ...plugins] : [...plugins, changeDefault],
    }).command(count);
  }

  const scenarios = {
    /** An author-declared "json" view kept with its own map and its declared position. */
    'author-json': () => {
      const mapped = json({
        map: (data) => ({ label: z.object({ label: z.string() }).parse(data).label }),
      });
      const count = new Command('count')
        .result({ views: { json: mapped, table } })
        .action(({ out }) => out.results({ label: 'a', value: 1 }));
      return new Application('app', { plugins })
        .command(count)
        .action(({ out }) => out.print('dispatched'));
    },
    /** An author-declared "ndjson" key, so the alias no longer serves and names it directly. */
    'author-ndjson': () => {
      const count = new Command('count')
        .result({ views: { ndjson: table, table } })
        .action(({ out }) => out.results({ label: 'a', value: 1 }));
      return new Application('app', { plugins })
        .command(count)
        .action(({ out }) => out.print('dispatched'));
    },
    'earlier-default': () => hookOrder(true),
    /** An earlier plugin assigns a view; an omitted --format leaves that assignment in place. */
    'earlier-view': () => {
      const count = new Command('count')
        .result({ views: { json: json(), table } })
        .action(({ out }) => out.results({ label: 'a', value: 1 }));
      return new Application('app', { plugins: [earlier, ...plugins] })
        .command(count)
        .action(({ out }) => out.print('dispatched'));
    },
    'later-default': () => hookOrder(false),
    'no-formatter': () =>
      new Application('app', { plugins: [help()] }).command(
        new Command('count')
          .result({ views: { table } })
          .action(({ out }) => out.results({ label: 'a', value: 1 })),
      ),
    /** A Command with no result, so --format is the unknown-option error and no help row. */
    'no-result': () => {
      const count = new Command('count').action(({ out }) => out.print('dispatched'));
      return new Application('app', { plugins })
        .command(count)
        .action(({ out }) => out.print('dispatched'));
    },
    /** The formatter given the short spelling -f, so -f selects a view as --format does. */
    short: () => {
      const count = new Command('count')
        .result({ views: { table } })
        .action(({ out }) => out.results({ label: 'a', value: 1 }));
      return new Application('app', {
        plugins: [help(), version(), format({ short: 'f' })],
      }).command(count);
    },
  };

  const factory = Object.entries(scenarios).find(([key]) => key === name)?.[1];
  if (factory === undefined) {
    throw new Error(`Unknown fixture scenario: ${name}`);
  }
  return factory();
}

async function run(args: string[] = []) {
  const [name = '', ...argv] = args;
  return await runOnMock(fixtureApplication(name), { argv, release: { build: 'distributed' } });
}

function inspect(name: string) {
  return fixtureApplication(name).inspect();
}

export { inspect, run };
