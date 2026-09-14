- Add one view registry for every rendered byte. `view(identity, definition)` declares a view, `override(key, view)` pairs a declared view or a failure class with a replacement, and both an Application and a plugin list them under `views`.
- Add `lanes`, the five declared views behind `print`, `info`, `success`, `warn`, and `error`. An override of a lane view owns the glyph gutter, and the semantic method still appends one newline.
- Add `helpPage` at `@loomcli/plugins/help/views` and `versionLine` at `@loomcli/plugins/version/views`, so an application brands the help page or the version line while the plugin stays installed.
- Remove the `failures` option, `renderFailure`, `FailureRenderer`, `Renderer`, and `RendererContext`. `Renderer` is now `View` and `RendererContext` is now `ViewContext`.
- Change failure resolution to walk each contributor in turn, the application first and then each plugin in installation order, and to walk the failure's prototype chain in full at each contributor. An application's override for a base class now beats a plugin's override for a subclass.
- Change the text of a non-string view return from `The renderer returned <type> instead of a string.` to `The view returned <type> instead of a string.`

### Migration

**Affected surface.** The `failures` Application option, the `renderFailure` function, the `FailureRenderer`, `Renderer`, and `RendererContext` types, a plugin's `failures` declaration, the resolution order between an application's base-class registration and a plugin's subclass registration, and diagnostics that quote the non-string return reason.

**Why.** A failure diagnostic, a semantic lane message, a help page, and a version line are all presentation an application owns. One registry gives them one override surface and one resolution, as [ADR-0021](docs/decisions/0021-every-rendered-byte-passes-through-one-registry-of-replaceable-views.md) decides, so branding a plugin's page and branding a failure class are the same call.

**Before and after.**

Before:

```ts
import { Application, InputError, renderFailure } from '@loomcli/core';
import type { Renderer } from '@loomcli/core';

const inputProblems: Renderer<InputError> = {
  render: (failure, { style }) => `${style.escape(failure.message)}\n`,
};

export const app = new Application('app', {
  failures: [renderFailure(InputError, inputProblems)],
});
```

After:

```ts
import { Application, InputError, override } from '@loomcli/core';
import type { View } from '@loomcli/core';

const inputProblems: View<InputError> = {
  render: (failure, { style }) => `${style.escape(failure.message)}\n`,
};

export const app = new Application('app', {
  views: [override(InputError, inputProblems)],
});
```

A plugin lists the views it declares beside the overrides it makes:

```ts
plugin('@acme/brand', { views: [brandPage, override(InputError, inputProblems)] });
```

**Steps.**

1. Rename the `Renderer<Data>` type to `View<Data>` and `RendererContext` to `ViewContext`. The `render` function itself is unchanged.
2. Replace each `failures` list with `views`, and each `renderFailure(Class, renderer)` entry with `override(Class, view)`. Do the same for a plugin's `failures` declaration.
3. Check any application that registers a base class, such as `UsageError`, beside a plugin that registers a subclass, such as `InputError`. The application's override now answers both. Register the subclass on the application too where the earlier order was intended.
4. Replace a call-site presentation you want an application to be able to brand with a declared view: export `view('<package>/<name>', definition)` from a `<subpath>/views` module and render it with `out.render(data, name)`. One identity means one object, so a second copy of the declaring package is a build error.
5. Update any test that asserts the `The renderer returned ...` reason, and any that asserts a diagnostic from the retired declaration rules; the `failures` option now reports `The Application options contain failures. Declare view overrides under views with override(key, view).`

**Validation.** Run `pnpm run check:types`, or `tsc --noEmit` in the application's own project, to find every retired name. Then run the output and failure tests under both runtimes: `pnpm exec vp test --run`, and `LOOM_TEST_RUNTIME=bun pnpm exec vp test --run`. Compare the bytes of each branded diagnostic, help page, and version line before and after the change.
