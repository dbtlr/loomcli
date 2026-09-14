import {
  Application,
  DeclarationError,
  InputError,
  lanes,
  override,
  plugin,
  UsageError,
  view,
} from '@loomcli/core';

const [scenario, ...argv] = process.argv.slice(2);

/** The view one plugin declares, so an application brands it without replacing the plugin. */
const page = view('@fixture/page', { render: (data) => `page: ${data.title}\n` });

/** A second object under the declared identity, which is what a second package copy looks like. */
const copy = view('@fixture/page', { render: (data) => `copy: ${data.title}\n` });

/** A view no installed plugin declares, so an override for it applies where it is rendered. */
const detached = view('@fixture/detached', { render: (data) => `detached: ${data.title}\n` });

/**
 * A hand-built object carrying an identity. It is a bare view to core, so it renders through its
 * own function and consults no override.
 */
const forged = { identity: '@fixture/page', render: (data) => `forged: ${data.title}\n` };

const brand = (label) => ({ render: (failure) => `${label}: ${failure.message}\n` });
const branded = (label) => ({ render: (data) => `${label}: ${data.title}\n` });
const breaks = {
  render: () => {
    throw new Error('Cannot render the view.');
  },
};

const dispatch = ({ out }) => out.print('dispatched');

/** The plugin that declares the page, under the overrides one scenario hands it. */
function declaring(views = []) {
  return plugin('@fixture/pages', { views: [page, ...views] });
}

/** An application that renders one value through the view a scenario hands it. */
function rendering(value, views, plugins = []) {
  return new Application('views', { plugins, views }).action(({ out }) =>
    out.render({ title: 'one' }, value),
  );
}

/** An application whose invocation omits a required option, so one usage failure reports. */
function failing(views, plugins = []) {
  return new Application('views', { plugins, views })
    .globalOption('file', { required: true, short: 'f', type: 'string' })
    .action(dispatch);
}

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
    case 'plugin-duplicate-view': {
      const twice = declaring([override(page, branded('one')), override(page, branded('two'))]);
      return rendering(page, [], [twice]);
    }
    case 'app-declares': {
      return rendering(page, [page]);
    }
    case 'plugin-foreign': {
      return rendering(page, [], [plugin('@fixture/pages', { views: [{}] })]);
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
      // The application's overrides are published before the plugins build, so a build fault
      // Reaches them; a plugin's overrides are not consulted, because build has not read them.
      const branding = plugin('@fixture/branding', {
        views: [override(DeclarationError, brand('plugin declaration'))],
      });
      const twice = plugin('@fixture/twice', {
        views: [override(InputError, brand('one')), override(InputError, brand('two'))],
      });
      return failing([override(DeclarationError, brand('app declaration'))], [branding, twice]);
    }
    case 'build-fault-unbranded': {
      const branding = plugin('@fixture/branding', {
        views: [override(DeclarationError, brand('plugin declaration'))],
      });
      const twice = plugin('@fixture/twice', {
        views: [override(InputError, brand('one')), override(InputError, brand('two'))],
      });
      return failing([], [branding, twice]);
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
      // The unawaited render fault is deferred; the action's own failure stays primary.
      return new Application('views').action(({ out }) => {
        out.render({ title: 'one' }, breaks);
        throw new InputError('Option "--file" is required. Supply a value.', []);
      });
    }
    case 'retired': {
      return new Application('views', { failures: [] }).action(dispatch);
    }
    default: {
      throw new Error(`Unknown scenario: ${scenario}`);
    }
  }
}

const code = await build().run({ host: { argv } });
process.stdout.write(`resolved:${code}\n`);
