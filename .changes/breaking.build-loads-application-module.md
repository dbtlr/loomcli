- Change `loom build` to import the application module before it bundles, for every target, in a Bun process of its own, so it can read the skills folder `skills()` names. A package that resolves `@loomcli/plugins` and has an application module apart from its entry now fails the build with `@loomcli/loom/application-load-failed` when that module throws while it loads, where an earlier build bundled it without running it. See [The skills folder](docs/toolchain/build.md#the-skills-folder).

### Migration

**Affected surface.** Packages built with `loom build` that depend on `@loomcli/plugins` and whose application module, `src/application.ts` by convention or the module `paths.application` or `--application` names, runs code at load that throws outside a real run, such as reading a file beside the installed binary or requiring an environment variable.

**Why.** The build learns the skills folder from the declaration, so it imports the module that declares the Application, as `loom init` already does.

**Before and after.**

Before, in `src/application.ts`:

```ts
const settings = JSON.parse(readFileSync(new URL('./settings.json', import.meta.url), 'utf8'));
export const notes = new Application('notes', { description: settings.description });
```

After, the work moves into an action or a function the action calls, so the module only declares:

```ts
export const notes = new Application('notes', { description: 'Take notes.' });
```

**Steps.**

1. Run `loom build` for each target the package builds.
2. If it fails with `@loomcli/loom/application-load-failed`, move the work the message names out of the module's top level, into an action, which runs only when its Command runs.

**Validation.** Run `loom build --target node` and `pnpm test` in the package; both pass with the module loading cleanly.
