import { Application, Command, DeclarationError, plugin } from '@loomcli/core';
import type { ActionContext } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';

import { runOnMock } from './in-process.ts';

/** Runs the fixture on isolated process facts and returns its recorded output. */
function fixtureApplication(name: string) {
  const table = { render: () => 'table\n' };

  /** A Command whose result carries one view, so the hook has something to reshape. */

  /** A plugin whose own option is named "format", installed ahead of format() in every scenario. */
  const claimant = plugin('@fixture/claimant', {
    options: { format: { description: 'Claim the name first.', type: 'boolean' } },
  });

  const scenarios = {
    /** A global option "format" on the Application, which every Command's hook sees. */
    'global-collision': () => {
      const count = new Command('count').result({ views: { table } }).action(dispatch);
      return new Application('app', { plugins: [format()] })
        .globalOption('format', { type: 'boolean' })
        .command(count)
        .action(dispatch);
    },
    /** A local option "format" on the Command the hook would otherwise reshape. */
    'local-collision': () => {
      const count = new Command('count')
        .option('format', { type: 'boolean' })
        .result({ views: { table } })
        .action(dispatch);
      return new Application('app', { plugins: [format()] }).command(count).action(dispatch);
    },
    /** Another plugin's own option "format", installed ahead of format(). */
    'plugin-collision': () => {
      const count = new Command('count').result({ views: { table } }).action(dispatch);
      return new Application('app', { plugins: [claimant, format()] })
        .command(count)
        .action(dispatch);
    },
    /** The short spelling -h, which help() installed ahead of format() already claims. */
    'short-help-collision': () => {
      const count = new Command('count').result({ views: { table } }).action(dispatch);
      return new Application('app', { plugins: [help(), format({ short: 'h' })] }).command(count);
    },
    /** The short spelling -f, which the Command's own --file already claims. */
    'short-local-collision': () => {
      const count = new Command('count')
        .option('file', { short: 'f', type: 'string' })
        .result({ views: { table } })
        .action(dispatch);
      return new Application('app', { plugins: [format({ short: 'f' })] }).command(count);
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
  try {
    fixtureApplication(name).inspect();
  } catch (error) {
    if (!(error instanceof DeclarationError)) {
      throw error;
    }
    const { findings, rule, sentence } = error;
    return { notes: findings.map((finding) => finding.note), rule: rule?.identity, sentence };
  }
  throw new Error('Expected the fixture declaration to fail.');
}

const dispatch = ({ out }: Pick<ActionContext<unknown>, 'out'>) => out.print('dispatched');

export { inspect, run };
