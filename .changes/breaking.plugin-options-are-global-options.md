- Change a plugin's options into global options, with no difference from the ones `globalOption()` declares. Each entry of a plugin's `options` record takes `GlobalOptionConfig`, the configuration `globalOption()` takes: everything `option()` takes except `required` and `validateOmitted`. A plugin's option may now carry a validator, a default of its validator's input type, and every other rule an option declaration meets. `plugin()` rejects `required` and `validateOmitted`, whatever their value, under `@loomcli/core/global-presence-rule`, such as `Plugin "@acme/log" option "level" declares required. Remove required, and check for the value in each Command that needs it.` The rule `@loomcli/core/plugin-option-rule` is removed. See [Global options from plugins](docs/core.md#global-options-from-plugins).
- Add the type `GlobalOptionConfig`, and remove the types `PluginStringOption` and `PluginOptionConfig`. `PluginOptions` is `Readonly<Record<string, GlobalOptionConfig>>`, and `PluginOptionValues` reads a validated option as its validator's output.
- Change validation so that a plugin's option values pass their validators with the application's global options, the application's own first in authoring order and then each plugin's in installation order. A rejected value is an input problem with exit code 2, reported with every other validation problem of the run. A configuration source's own options pass their validators before the source is called, and a rejected one holds its input problem and the source is never called. The global options are now validated when a local option holds a fault too.
- Change every action's `options` to hold every global option's validated value, the application's and every plugin's, a plugin Command's action included. An action's type names them through the constructor's `plugins` tuple, and a Command built where the Application's `Register` augmentation is visible names them through `EnvironmentOf`. In both places `.option()` now rejects a plugin option's name at compile time, as it rejects an application global option's.
- Change `MiddlewareContext.options` to hold every global option's validated value, the application's and every plugin's, keyed by declared name, typed `(PluginOptionValues<Options> & Readonly<Record<string, unknown>>) | null`. It is `null` when a global option was rejected, and a fault on a local option alone leaves it set. Each value is a copy frozen to every depth, as the request's values are. Activation and `spellings` still cover the plugin's own options alone.
- Remove `OptionNode.scope`. A global option reads the same whether the application or a plugin declared it.

### Migration

**Affected surface.** A plugin whose `options` record is typed with `PluginStringOption` or `PluginOptionConfig`, or whose option declares `required` or `validateOmitted`. A middleware that reads `options`, assumes it holds the plugin's own options alone, or writes to a value in it. Code that reads `OptionNode.scope`. An `Application<Args, Options, Globals>` annotation whose `Globals` omits the installed plugins' option values. An Application that attaches Commands built under another Application's `Register` augmentation without installing the same plugins. Code that serializes or compares an action's whole `options` object.

**Why.** A plugin's options were a second class of global option that parsed with the globals but carried no validator and reached their own plugin's middleware alone. They are now ordinary global options, so they validate once with the application's, and every action and every middleware reads them under [ADR-0055](docs/decisions/0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md).

**Before and after.**

Before, the plugin declared its option without a validator, and its middleware checked the raw value:

```ts
import type { Middleware, PluginOptionConfig } from '@loomcli/core';

const options = { level: { type: 'string' } } satisfies Record<string, PluginOptionConfig>;

const middleware: Middleware<typeof log> = ({ next, options }) => {
  if (options.level !== undefined && !['debug', 'info'].includes(options.level)) {
    throw new FatalError('Use debug or info.');
  }
  return next();
};
```

After, the option carries its validator, and the middleware handles `null`:

```ts
import type { Middleware, PluginOptions } from '@loomcli/core';
import { oneOf } from '@loomcli/validators';

const options = { level: { type: 'string', validate: oneOf(['debug', 'info']) } } satisfies PluginOptions;

const middleware: Middleware<typeof log> = ({ next, options }) => {
  // `options` is null when a global option was rejected, and core reports that problem.
  const level: 'debug' | 'info' | undefined = options?.level;
  configureLogging(level);
  return next();
};
```

Before, an annotation named the application's own global options:

```ts
function serve(app: Application<{}, {}, { file: string | undefined }>) {}
```

After, it names the configured Application's environment, which holds the plugins' option values too:

```ts
function serve(app: Application<{}, {}, EnvironmentOf<typeof configured>['globals']>) {}
```

**Steps.**

1. Replace `PluginStringOption` and `PluginOptionConfig` with `GlobalOptionConfig`, or declare the record with `satisfies PluginOptions`.
2. Remove `required` and `validateOmitted` from each plugin option, and check for the value in each Command that needs it.
3. Move a check a middleware made on its own option's raw value into the option's validator, and read the validator's output.
4. In each middleware that reads `options`, handle `null`, read another plugin's or the application's option as `unknown`, and copy a value before changing it.
5. Replace each read of `OptionNode.scope`. A plugin's options are the names its own declaration holds.
6. Install the same plugins in every Application that attaches Commands built under one `Register` augmentation, and name the globals of an `Application` annotation with `EnvironmentOf<typeof configured>['globals']`.

**Validation.** Run the application's type check, such as `tsc --noEmit`, to find each removed type, presence rule, `scope` read, and annotation. Run the application's tests, then run the application with a value each plugin option's validator rejects, and check that it exits 2 with the validator's message.
