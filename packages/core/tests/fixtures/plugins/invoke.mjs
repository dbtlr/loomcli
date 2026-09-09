import { setTimeout as after } from 'node:timers/promises';

import {
  Application,
  Command,
  FatalError,
  GlobalOptions,
  InputError,
  plugin,
  renderFailure,
} from '@loomcli/core';

import { argumentFact, commandFact, optionFact } from './extensions.mjs';

const load = (module) => () => import(`./modules/${module}.mjs`);

/** Each fixture plugin, named by the key a scenario installs it under. */
const plugins = {
  broken: () =>
    plugin('@fixture/broken', {
      middleware: { activate: 'always', load: () => import('./modules/missing.mjs') },
    }),
  catching: () =>
    plugin('@fixture/catching', { middleware: { activate: 'always', load: load('catching') } }),
  facts: () =>
    plugin('@fixture/facts', {
      extensions: [argumentFact, commandFact, optionFact],
      middleware: { activate: 'always', load: load('reading') },
    }),
  failures: () =>
    plugin('@fixture/failures', {
      failures: [
        renderFailure(InputError, { render: (failure) => `plugin input: ${failure.message}\n` }),
        renderFailure(FatalError, { render: (failure) => `plugin fatal: ${failure.message}\n` }),
      ],
    }),
  help: () =>
    plugin('@fixture/help', {
      middleware: { activate: ['help'], load: load('help') },
      options: { help: { short: 'h', type: 'boolean' } },
    }),
  inner: () =>
    plugin('@fixture/inner', { middleware: { activate: 'always', load: load('inner') } }),
  misuse: () =>
    plugin('@fixture/misuse', { middleware: { activate: 'always', load: load('misuse') } }),
  'no-default': () =>
    plugin('@fixture/no-default', {
      middleware: { activate: 'always', load: load('no-default') },
    }),
  outer: () =>
    plugin('@fixture/outer', { middleware: { activate: 'always', load: load('outer') } }),
  settings: () =>
    plugin('@fixture/settings', {
      middleware: { activate: ['cache', 'mode', 'quiet', 'tags'], load: load('settings') },
      options: {
        cache: { polarity: 'both', type: 'boolean' },
        mode: { default: 'plain', short: 'm', type: 'string' },
        quiet: { short: 'q', type: 'boolean' },
        tags: { default: ['one'], multiple: true, type: 'string' },
      },
    }),
  signals: () =>
    plugin('@fixture/signals', { middleware: { activate: 'always', load: load('signals') } }),
  throwing: () =>
    plugin('@fixture/throwing', { middleware: { activate: 'always', load: load('throwing') } }),
  version: () =>
    plugin('@fixture/version', {
      middleware: { activate: ['version'], load: load('version') },
      options: { version: { type: 'boolean' } },
    }),
};

/** What each scenario installs, in the order the chain composes them. */
const installed = {
  broken: ['broken'],
  catching: ['catching'],
  facts: ['facts'],
  failures: ['failures'],
  'failures-both': ['failures'],
  help: ['help', 'version'],
  inert: [],
  misuse: ['misuse'],
  'no-default': ['no-default'],
  settings: ['settings'],
  signals: ['signals'],
  throwing: ['throwing'],
  wrapped: ['outer', 'inner'],
  'wrapped-help': ['outer', 'help'],
};

const scenario = process.argv[2];
const mode = process.argv[3];
const argv = process.argv.slice(4);

/**
 * One graph every scenario shares, so an invocation reads the same declarations whichever plugins
 * it installs. The extension values sit across the graph, and stay inert when no plugin defines
 * their descriptors.
 */
function application() {
  const globals = new GlobalOptions().option('file', {
    description: 'The document to read.',
    extensions: [optionFact({ placeholder: 'path' })],
    short: 'f',
    type: 'string',
  });
  const get = new Command('get', {
    description: 'Read one value at a path.',
    extensions: [commandFact({ details: 'Reads one value.', examples: ['get user.name'] })],
    globals,
  })
    .argument('path', {
      description: 'Dot path to read.',
      extensions: [argumentFact({ hint: 'a dot path' })],
      required: true,
    })
    .option('raw', {
      description: 'Print the value unquoted.',
      extensions: [optionFact({ placeholder: 'raw' })],
      type: 'boolean',
    })
    .action(async ({ args, options, out, signal }) => {
      // A macrotask, so a call the misuse fixture stashed lands after its middleware returned.
      await after(0);
      if (process.env.LOOM_FIXTURE_MISUSE === 'after-return') {
        const module = await import('./modules/misuse.mjs');
        await module.stashed.next().catch((error) => out.info(`misuse:${error.message}`));
      }
      if (process.env.LOOM_FIXTURE_ACTION === 'fatal') {
        out.fatal('the action stopped the invocation');
      }
      await out.print(`get:${args.path}:${JSON.stringify(options)}`);
      await out.print(`action-signal:${signal instanceof AbortSignal}:${signal.aborted}`);
    });
  return new Application('app', {
    description: 'A fixture application.',
    extensions: [commandFact({ details: 'The whole fixture.' })],
    // The application registers first, so its renderer wins over the plugin's for one class.
    failures:
      scenario === 'failures-both'
        ? [renderFailure(InputError, { render: (failure) => `app input: ${failure.message}\n` })]
        : [],
    globals,
    plugins: (installed[scenario] ?? []).map((name) => plugins[name]()),
    version: '1.2.0',
  })
    .command(get)
    .action(({ out }) => out.print('root'));
}

if (mode === 'inspect') {
  process.stdout.write(`${JSON.stringify(application().inspect())}\n`);
} else if (mode === 'twice') {
  // One Application, run twice, so each run reads its declarations and its defaults anew.
  const app = application();
  const first = await app.run({ host: { argv } });
  const second = await app.run({ host: { argv } });
  process.stdout.write(`resolved:${first}:${second}\n`);
} else {
  const code = await application().run({ host: { argv } });
  process.stdout.write(`resolved:${code}\n`);
}
