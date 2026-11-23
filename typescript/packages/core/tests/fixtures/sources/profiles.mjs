import { Application, Command, plugin } from '@loomcli/core';
import { integer, oneOf } from '@loomcli/validators';

import { scenario as fixtureScenario } from '../scenario.mjs';
import { configKey } from './extension.mjs';
import { sourceModule } from './source.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;
  try {
    /**
     * A configuration plugin whose own option takes a validator, and an application whose global
     * options are validated too, so a test reads every rejected value in one report.
     */
    const profiles = plugin('@fixture/profiles', {
      extensions: [configKey],
      options: { profile: { type: 'string', validate: oneOf(['dev', 'prod']) } },
      source: {
        binding: configKey,
        load: () => sourceModule({ abort: () => abort(), env: fixtureEnv, stdout: writeStdout }),
      },
    });

    /** An absence rule: the validator itself rejects an omitted value. */
    const present = {
      '~standard': {
        validate: (value) =>
          value === undefined ? { issues: [{ message: 'Supply a region.' }] } : { value },
        vendor: 'fixture',
        version: 1,
      },
    };

    // `name` is required and bound to the source, and `region` sends its omission to its validator.
    // `title` is required and bound to nothing.
    const named = new Command('x')
      .option('name', { extensions: [configKey('name')], required: true, type: 'string' })
      .option('region', {
        extensions: [configKey('region')],
        type: 'string',
        validate: present,
        validateOmitted: true,
      })
      .option('title', { required: true, type: 'string' })
      .action(({ options, out }) => out.print(`x:${JSON.stringify(options)}`));

    const app = new Application('app', { plugins: [profiles] })
      .globalOption('size', { type: 'string', validate: integer() })
      .globalOption('owner', { extensions: [configKey('owner')], type: 'string' })
      .command(named)
      .action(({ options, out }) => out.print(`root:${JSON.stringify(options)}`));

    const code = await app.run({
      process: createProcess({ argv: words }),
    });
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const abort = () => {};

export { runFixture as run };
