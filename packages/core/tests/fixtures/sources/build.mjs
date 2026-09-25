import { Application, Command, DeclarationError, extension, plugin } from '@loomcli/core';
import { z } from 'zod';

import { declare } from '../declare.mjs';

const dispatch = ({ out }) => out.print('dispatched');

const load = () => import('./source.mjs');

/** The binding every source row declares, and a Command-target descriptor under the same name. */
const configKey = extension('@acme/config/key', { schema: z.string(), target: 'option' });
const commandKey = extension('@acme/config/key', { schema: z.string(), target: 'command' });
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
  'argument-env': () =>
    new Application('app')
      .command(new Command('get').argument('path', { env: 'PATH_TO' }).action(dispatch))
      .action(dispatch),
  'binding-not-listed': () =>
    withPlugins(plugin('@acme/config', { source: { binding: configKey, load } })),
  'binding-own-option': () =>
    withPlugins(
      config(
        { binding: configKey, load },
        { options: { config: { extensions: [configKey('config')], type: 'string' } } },
      ),
    ),
  'binding-wrong-target': () =>
    withPlugins(
      plugin('@acme/config', { extensions: [commandKey], source: { binding: commandKey, load } }),
    ),
  'env-grammar': () =>
    new Application('app')
      .globalOption('limit', { env: '9LIMIT', type: 'string' })
      .action(dispatch),
  'env-multiple': () =>
    new Application('app')
      .globalOption('field', { env: 'FIELDS', multiple: true, type: 'string' })
      .action(dispatch),
  'env-not-string': () =>
    new Application('app').globalOption('limit', { env: 7, type: 'string' }).action(dispatch),
  'local-env-grammar': () =>
    new Application('app')
      .command(
        new Command('count').option('limit', { env: 'LIMIT-X', type: 'string' }).action(dispatch),
      )
      .action(dispatch),
  'plugin-env-grammar': () =>
    withPlugins(plugin('@loomcli/log', { options: { verbose: { env: '', type: 'boolean' } } })),
  'plugin-env-multiple': () =>
    withPlugins(
      plugin('@loomcli/log', {
        options: { tags: { env: 'TAGS', multiple: true, type: 'string' } },
      }),
    ),
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
  'sibling-variable': () =>
    new Application('app')
      .command(
        new Command('count').option('max', { env: 'SHARED', type: 'string' }).action(dispatch),
      )
      .command(new Command('sum').option('cap', { env: 'SHARED', type: 'string' }).action(dispatch))
      .action(dispatch),
  'source-no-load': () => withPlugins(config({ binding: configKey })),
  'source-not-object': () => withPlugins(config('settings.json')),
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

const app = declare(scenarios[process.argv[2]]);
const mode = process.argv[3];

if (mode === 'inspect') {
  try {
    app.inspect();
    process.stdout.write('inspected\n');
  } catch (error) {
    const kind = error instanceof DeclarationError ? 'declaration' : 'other';
    process.stdout.write(`${kind}:${error.exitCode}: ${error.message}\n`);
  }
} else {
  const code = await app.run({ host: { argv: [] } });
  process.stdout.write(`resolved:${code}\n`);
}
