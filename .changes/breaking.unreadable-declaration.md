- Add the rule `@loomcli/core/unreadable-declaration`. `argument()`, `option()`, `globalOption()`, an input a lifecycle hook declares, and `plugin()` for the config object of each option it declares now read that config once, at the call, and a read that throws, such as a getter or a proxy trap that throws at any depth of the default, throws a `DeclarationError` from that call, such as `Option "format" config could not be read: boom.`, with the thrown value as its `cause`. Before, the throw escaped as the raw error, or, inside a default, broke `inspect()` and every plugin that reads the graph. A getter on a plugin's `options` record itself is not covered and still escapes as the raw error.
- Change a declared default to one frozen snapshot that the declaring call takes. The graph publishes it, and a run passes the same frozen copy to the default's validator, so a validator, or an action that receives the validator's output unchanged, can no longer write to an object default. An array default still reaches the action as its own mutable copy, holes included.
- Fix a default, or a converter's JSON Schema, that holds itself. Core copies it with the same cycle instead of overflowing the stack, so `inspect()`, help, and the suggestions plugin work, a development build no longer reports a cyclic converter answer as `@loomcli/core/schema-converter-failed`, and the manifest reports that it cannot encode the value as JSON. See the [core reference](docs/core.md).

### Migration

**Affected surface.** A config passed to `argument()`, `option()`, `globalOption()`, or a lifecycle hook's `argument()` or `option()`, and the config object of one option in a plugin's `options`, whose own properties or default throw when read. A default's validator or an action that writes to an object default it receives.

**Why.** Core reads a declaration once, at the call that declares it, so every check, the graph, and every run read one copy. A read that throws now reports at that call, and the copy every reader shares is frozen so that no reader can change it for another.

**Before and after.**

Before, the declaration was accepted, and the first `inspect()` threw `boom`:

```ts
app.option('format', { default: { get style(): string { throw new Error('boom'); } }, type: 'string', validate });
```

After, declare the default as plain data:

```ts
app.option('format', { default: { style: 'plain' }, type: 'string', validate });
```

Before, a hand-written validator's `'~standard'.validate` method could normalize a default in place:

```ts
const validate: StandardSchemaV1<{ style?: string }> = {
  '~standard': {
    validate: (value) => {
      if (typeof value !== 'object' || value === null) {
        return { issues: [{ message: 'Expected an object.' }] };
      }
      Object.assign(value, { style: 'plain', ...value });
      return { value };
    },
    vendor: 'acme',
    version: 1,
  },
};
```

After, the method returns a new value:

```ts
const validate: StandardSchemaV1<{ style?: string }> = {
  '~standard': {
    validate: (value) =>
      typeof value === 'object' && value !== null
        ? { value: { style: 'plain', ...value } }
        : { issues: [{ message: 'Expected an object.' }] },
    vendor: 'acme',
    version: 1,
  },
};
```

**Steps.**

1. Replace each getter or proxy in a declaration config, and in its default, with the plain value it returns.
2. Change each validator or action that writes to an object default it receives so that it builds a new value instead.

**Validation.** Run `inspect()` on the Application in a test, and run each Command with no tokens so that every default passes through its validator and reaches its action. `inspect()` throws no `DeclarationError`, and no run reports `@loomcli/core/unreadable-declaration` or `@loomcli/core/validator-failed`.
