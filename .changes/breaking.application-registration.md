- Restore automatic Application global types in independently authored Commands and extracted actions through one shallow `Register.environment` augmentation.
- Replace `GlobalOptions` and constructor `globals` configuration with `Application.globalOption(name, config)`. The Application supplies validated global values to every action.
- Add immutable `Command.extend()` and `Application.extend()` calls that remain available after action registration. A later value replaces the complete earlier value from the same descriptor.

### Migration

**Affected surface.** `GlobalOptions`, constructor `globals` options on Application and Command, explicit global type arguments on either constructor, `CommandOptions<Globals>`, `ApplicationOptions<Globals>`, and TypeScript Commands whose actions read Application globals.

**Why.** Application ownership should require one declaration, with global types available throughout its compiler project.

**Before and after.**

Before:

```ts
const globals = new GlobalOptions().option('file', { required: true, type: 'string' });
const read = new Command('read', { globals }).action(handler);
const app = new Application('app', { globals }).command(read);
```

After, in the Application module:

```ts
import type { EnvironmentOf } from '@loomcli/core';

const configured = new Application('app')
  .globalOption('file', { required: true, type: 'string' });
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}
const app = configured.command(read);
```

The Command module now uses `new Command('read').action(handler)` without importing globals.

**Steps.**

1. Replace each `GlobalOptions.option()` declaration with `Application.globalOption()`. Remove the `GlobalOptions` import, the separate globals value, and constructor `globals` properties. Remove global type arguments from both constructors and from `ApplicationOptions`; use `CommandOptions` without a type argument.
2. Declare all global options before the first `command()` or `action()` call. Register that configured Application value.
3. Include the registration module in that application's TypeScript project. Use separate projects for applications with different registrations; reusable libraries omit consumer registration.
4. To customize an imported Command, derive `command.extend(extensionValue)` and attach the returned value. Keep a self-typed extracted handler's original initializer ending in `action()`.

**Validation.** Run the application's TypeScript check and invocation tests. Confirm detached actions infer global schema outputs, unknown keys fail, and existing global CLI spellings still reach their actions. See the [SDK reference](docs/core.md#modular-authoring).
