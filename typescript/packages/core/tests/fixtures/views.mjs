import {
  Application,
  Command,
  DeclarationError,
  InputError,
  lanes,
  override,
  plugin,
  UsageError,
  view,
} from '@loomcli/core';

import { ruleText } from './rule-text.mjs';
import { scenario as fixtureScenario } from './scenario.mjs';

/** Runs a fresh fixture scenario with only the supplied process facts. */
async function runFixture(words, fixtureOptions = {}) {
  const fixture = fixtureScenario({ ...fixtureOptions, argv: words });
  const { createProcess, stdout: writeStdout } = fixture;

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
    const [scenario, ...argv] = words;

    /** The view one plugin declares, so an application brands it without replacing the plugin. */
    const page = view('@fixture/page', { render: (data) => `page: ${data.title}\n` });

    /** A second object under the declared identity, which is what a second package copy looks like. */
    const copy = view('@fixture/page', { render: (data) => `copy: ${data.title}\n` });

    /** The row view one plugin declares, which an application replaces by reference like any other. */
    const records = view('@fixture/records', {
      head: () => 'ROWS\n',
      row: (row, index) => `${index}: ${row.title}\n`,
    });

    /** A view no installed plugin declares, so an override for it applies where it is rendered. */
    const detached = view('@fixture/detached', { render: (data) => `detached: ${data.title}\n` });

    /**
     * A hand-built object carrying an identity. It is a bare view to core, so it renders through its
     * own function and consults no override.
     */
    const forged = { identity: '@fixture/page', render: (data) => `forged: ${data.title}\n` };

    // A declaration fault holds its sentence apart from the diagnostic its message carries.

    const breaks = {
      render: () => {
        throw new Error('Cannot render the view.');
      },
    };

    /** The plugin that declares the page, under the overrides one scenario hands it. */
    function declaring(views = []) {
      return plugin('@fixture/pages', { views: [page, ...views] });
    }

    /** An application that renders a sequence through the row view a scenario hands it. */
    function streaming(views, plugins = []) {
      return new Application('views', { plugins, views }).action(({ out }) =>
        out.render([{ title: 'one' }, { title: 'two' }], records),
      );
    }

    /** An application that renders one value through the view a scenario hands it. */

    /** An application whose invocation omits a required option, so one usage failure reports. */
    function failing(views, plugins = []) {
      return new Application('views', { plugins, views })
        .option('file', { required: true, short: 'f', type: 'string' })
        .action(dispatch);
    }

    /** The application's own brand for a declaration failure, listed wherever one is expected. */
    const declarationBrand = [override(DeclarationError, brand('app declaration'))];

    /** A plugin that brands a declaration failure, which a build fault never reaches. */
    const pluginBrand = plugin('@fixture/branding', {
      views: [override(DeclarationError, brand('plugin declaration'))],
    });

    function build() {
      switch (scenario) {
        case 'declared-default': {
          return rendering(page, [], [declaring()]);
        }
        case 'plugin-override': {
          const branding = declaring([override(page, branded('plugin'))]);
          return rendering(page, [], [branding]);
        }
        case 'shared-key': {
          const plugins = [declaring([override(page, branded('plugin'))])];
          return rendering(page, [override(page, branded('app'))], plugins);
        }
        case 'row-declared': {
          return streaming([], [plugin('@fixture/records', { views: [records] })]);
        }
        case 'row-override': {
          const rows = plugin('@fixture/records', { views: [records] });
          const replacement = override(records, { row: (row) => `app: ${row.title}\n` });
          return streaming([replacement], [rows]);
        }
        case 'inert': {
          return failing([override(detached, branded('app'))]);
        }
        case 'inert-rendered': {
          return rendering(detached, [override(detached, branded('app'))]);
        }
        case 'bare-identity': {
          return rendering(forged, [override(page, branded('app'))], [declaring()]);
        }
        case 'duplicate-identity': {
          return rendering(page, [override(copy, branded('app'))], [declaring()]);
        }
        case 'duplicate-declaration': {
          return rendering(page, [], [plugin('@fixture/pages', { views: [page, copy] })]);
        }
        case 'app-duplicate-view': {
          return rendering(page, [override(page, branded('one')), override(page, branded('two'))]);
        }
        case 'usage-over-input': {
          const inputs = plugin('@fixture/inputs', {
            views: [override(InputError, brand('plugin input'))],
          });
          return failing([override(UsageError, brand('app usage'))], [inputs]);
        }
        case 'plugins-order': {
          const usage = plugin('@fixture/usage', {
            views: [override(UsageError, brand('first usage'))],
          });
          const inputs = plugin('@fixture/inputs', {
            views: [override(InputError, brand('second input'))],
          });
          return failing([], [usage, inputs]);
        }
        case 'build-fault': {
          // The application's overrides are published before the graph builds.
          // A plugin's overrides are not consulted, because the build that fails never finished.
          // A root with neither children nor an action is final only at build.
          return new Application('views', { plugins: [pluginBrand], views: declarationBrand });
        }
        case 'build-fault-unbranded': {
          return new Application('views', { plugins: [pluginBrand], views: [] });
        }
        case 'global-name': {
          return new Application('views', { views: declarationBrand })
            .globalOption('-file', { type: 'string' })
            .action(dispatch);
        }
        case 'shared-child': {
          const shared = new Command('shared').action(dispatch);
          return new Application('views', { plugins: [pluginBrand], views: [] })
            .command(new Command('one').command(shared).action(dispatch))
            .command(new Command('two').command(shared).action(dispatch));
        }
        case 'lane-warn': {
          return new Application('views', {
            views: [override(lanes.warn, { render: (message) => `warned: ${message}` })],
          }).action(({ out }) => out.warn('careful'));
        }
        case 'lane-empty': {
          return new Application('views', {
            views: [override(lanes.warn, { render: () => '' })],
          }).action(({ out }) => out.warn('careful'));
        }
        case 'lane-broken': {
          return new Application('views', { views: [override(lanes.warn, breaks)] }).action(
            async ({ out }) => {
              await out.warn('careful').catch(() => out.print('caught'));
            },
          );
        }
        case 'lane-rendered': {
          return new Application('views').action(({ out }) => out.render('bare', lanes.print));
        }
        case 'render-then-failure': {
          // The unawaited render fails after the action's own failure, which stays primary.
          return new Application('views').action(({ out }) => {
            out.render({ title: 'one' }, breaks);
            throw new InputError('Option "--file" is required. Supply a value.', []);
          });
        }
        default: {
          throw new Error(`Unknown scenario: ${scenario}`);
        }
      }
    }

    const app = declare(build);
    const code = await app.run({
      process: createProcess({ argv, release: { build: 'distributed' } }),
    });
    writeStdout(`resolved:${code}\n`);
  } catch (error) {
    if (error !== fixture.stopped) {
      fixture.thrown(error);
    }
  }
  return fixture.result();
}

const brand = (label) => ({
  render: (failure) => `${label}: ${ruleText(failure)}\n`,
});
const branded = (label) => ({ render: (data) => `${label}: ${data.title}\n` });
const dispatch = ({ out }) => out.print('dispatched');
function rendering(value, views, plugins = []) {
  return new Application('views', { plugins, views }).action(({ out }) =>
    out.render({ title: 'one' }, value),
  );
}

export { runFixture as run };
