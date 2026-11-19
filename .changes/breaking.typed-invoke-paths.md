- Change `app.invoke` and an action's `invoke` to type a literal path and its values from the Commands the Application declares. A mistyped Command name in a literal path, an option or argument the routed Command does not declare, and a value of the wrong kind are compile errors, such as `Type '"gte"' is not assignable to type '"get" | "remote"'`. A path typed as `readonly string[]` keeps the dynamic `InvocationValues`, as do a union of literal paths, an alias, a path deeper than four Commands, and a first name an Application with plugins does not declare. See [Typed paths](docs/core/invocation.md#typed-paths).
- Add `Register.paths`, which `PathsOf<typeof app>` fills, so an action's `invoke` types a literal path in a registered compilation, and export `CommandPaths`, `PathsOf`, and `Invoke`.

### Migration

**Affected surface.** The type checker reports every affected site. The surface is an `invoke` call with a literal path, such as `[]` or `['get']`, whose values name an input the routed Command and the global options do not declare, name an option a plugin's attach hook adds, such as the `--format` and `--fields` options `format()` adds to every Command with a result, use an alias in the path, or are a variable typed as `InvocationValues`; and a variable or parameter whose inferred type is one Application's or one Command's and that is given another one that declares different Commands or another name.

**Why.** Each Command and Application now carries its Command paths in its type, so `invoke` can check a literal path and its values, and two values that declare different Commands no longer share a type.

**Before and after.**

Before, values built elsewhere with a literal path:

```ts
const values: InvocationValues = { options: { file: 'doc.json' } };
await app.invoke([], values);
```

After, the path is dynamic, as the values are:

```ts
const values: InvocationValues = { options: { file: 'doc.json' } };
const root: readonly string[] = [];
await app.invoke(root, values);
```

Before, a parameter that takes its type from one Application:

```ts
const run = (application = app()) => runOnMock(application, { argv: [] });
```

After, it takes the neutral annotation:

```ts
const run = (application: Application = app()) => runOnMock(application, { argv: [] });
```

**Steps.**

1. Run the type checker and open each reported `invoke` call.
2. Correct a mistyped Command, option, or argument name, or a value of the wrong kind, that the call meant to supply.
3. For a call that supplies `format` to select a view, such as `{ options: { format: 'json' } }`, pass the view in the call's options instead, as `invoke(['list'], {}, { view: 'json' })`.
4. For a call that supplies an undeclared name on purpose, another option an attach hook adds, such as `fields`, names an alias, or passes values typed as `InvocationValues`, pass the path as a `readonly string[]` value.
5. Give a variable or parameter that holds Applications or Commands declaring different Commands the `Application` or `Command` annotation.
6. To type an action's `invoke`, add `paths: PathsOf<typeof app>` to the `Register` augmentation, naming the completed Application.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its tests: each `invoke` call compiles, and every call whose path is dynamic behaves as before.
