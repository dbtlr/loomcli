import { Application, Command, DeclarationError, extension, plugin } from '@loomcli/core';
import { z } from 'zod';

import { ruleText } from '../rule-text.mjs';
import { scenario as fixtureScenario } from '../scenario.mjs';
import { sourceModule } from './source.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, env: fixtureEnv, stdout: writeStdout } = fixture;

  function declare(build) {
    try {
      return build();
    } catch (error) {
      if (!(error instanceof DeclarationError)) {
        throw error;
      }
      writeStdout(`thrown:${error.exitCode}: ${ruleText(error)}\n`);
      throw fixture.stopped;
    }
  }
  try {
    const load = () => sourceModule({ abort: () => abort(), env: fixtureEnv, stdout: writeStdout });

    /** The binding every source row declares. */
    const configKey = extension('@acme/config/key', { schema: z.string(), target: 'option' });
    const yamlKey = extension('@acme/yaml/key', { schema: z.string(), target: 'option' });

    /** A configuration plugin whose source declaration each row replaces. */
    function config(source, extra = {}) {
      return plugin('@acme/config', { extensions: [configKey], source, ...extra });
    }

    /** The shortest application that installs the plugins one row names. */
    function withPlugins(...plugins) {
      return new Application('app', { plugins }).action(dispatch);
    }

    const scenarios = {
      'env-list-repeat': () =>
        new Application('app')
          .globalOption('limit', { env: ['LIMIT', 'MAX', 'LIMIT'], type: 'string' })
          .action(dispatch),
      'env-list-twice': () =>
        new Application('app')
          .globalOption('limit', { env: ['TEXTSTAT_LIMIT', 'TEXTSTAT_MAX'], type: 'string' })
          .command(
            new Command('count')
              .option('max', { env: ['TEXTSTAT_CAP', 'TEXTSTAT_MAX'], type: 'string' })
              .action(dispatch),
          )
          .action(dispatch),
      'root-variable-twice': () =>
        new Application('app')
          .globalOption('limit', { env: 'TEXTSTAT_LIMIT', type: 'string' })
          .option('max', { env: 'TEXTSTAT_LIMIT', type: 'string' })
          .action(dispatch),
      'second-source': () =>
        withPlugins(
          config({ binding: configKey, load }),
          plugin('@acme/yaml', { extensions: [yamlKey], source: { binding: yamlKey, load } }),
        ),
      'sibling-list': () =>
        new Application('app')
          .command(
            new Command('count')
              .option('max', { env: ['SHARED', 'OTHER'], type: 'string' })
              .action(dispatch),
          )
          .command(
            new Command('sum').option('cap', { env: 'SHARED', type: 'string' }).action(dispatch),
          )
          .action(dispatch),
      'sibling-variable': () =>
        new Application('app')
          .command(
            new Command('count').option('max', { env: 'SHARED', type: 'string' }).action(dispatch),
          )
          .command(
            new Command('sum').option('cap', { env: 'SHARED', type: 'string' }).action(dispatch),
          )
          .action(dispatch),
      'variable-local-twice': () =>
        new Application('app')
          .command(
            new Command('count')
              .option('max', { env: 'TEXTSTAT_LIMIT', type: 'string' })
              .option('min', { env: 'TEXTSTAT_LIMIT', type: 'string' })
              .action(dispatch),
          )
          .action(dispatch),
      'variable-plugin-twice': () =>
        new Application('app', {
          plugins: [
            plugin('@loomcli/log', { options: { verbose: { env: 'VERBOSE', type: 'boolean' } } }),
          ],
        })
          .globalOption('loud', { env: 'VERBOSE', type: 'boolean' })
          .action(dispatch),
      'variable-twice': () =>
        new Application('app')
          .globalOption('limit', { env: 'TEXTSTAT_LIMIT', type: 'string' })
          .command(
            new Command('count')
              .option('max', { env: 'TEXTSTAT_LIMIT', type: 'string' })
              .action(dispatch),
          )
          .action(dispatch),
    };

    const app = declare(scenarios[words[0]]);
    const mode = words[1];

    if (mode === 'inspect') {
      try {
        app.inspect();
        writeStdout('inspected\n');
      } catch (error) {
        const kind = error instanceof DeclarationError ? 'declaration' : 'other';
        writeStdout(`${kind}:${error.exitCode}: ${error.sentence ?? error.message}\n`);
      }
    } else {
      const code = await app.run({ process: createProcess({ argv: [] }) });
      writeStdout(`resolved:${code}\n`);
    }
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const dispatch = ({ out }) => out.print('dispatched');
const abort = () => {};

export { runFixture as run };
