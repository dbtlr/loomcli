- Add the rule `@loomcli/core/unreadable-declaration`. Every declaring call now reads its declaration once, at the call, copying every own string key, enumerable or not: `argument()`, `option()`, `globalOption()`, and an input a lifecycle hook declares read their config, its `extensions` list included; `plugin()` reads its whole definition, the `options` record and each option's config included; and `new Application()` and `new Command()` read their options. Every later check, every finding, and the graph read that one copy, so a getter runs once and a finding prints the value the rule judged. A read that throws, such as a getter or a proxy trap that throws, or one at any depth of a default, throws a `DeclarationError` from that call, such as `Option "format" config could not be read: boom.`, `Plugin "@acme/log" definition could not be read: boom.`, or `The Application options could not be read: boom.`, with the thrown value as its `cause`. Before, the throw escaped as the raw error, or, inside a default, broke `inspect()` and every plugin that reads the graph.
- Change a declared default to one frozen snapshot that the declaring call takes. The graph publishes it, and a run passes the same frozen copy to the default's validator, so a validator, or an action that receives the validator's output unchanged, can no longer write to an object default. An array default still reaches the action as its own mutable copy, holes included.
- Fix a converter's JSON Schema that holds itself. Core copies it with the same cycle instead of overflowing the stack, so a development build no longer reports it as `@loomcli/core/schema-converter-failed`, and the manifest reports that it cannot encode the schema as JSON. See the [core reference](docs/core.md).

### Migration

**Affected surface.** A config passed to `argument()`, `option()`, `globalOption()`, or a lifecycle hook's `argument()` or `option()`, whose own properties, `extensions` list, or default throw when read. A `plugin()` definition, an options object passed to `new Application()` or `new Command()`, or a plain object or list nested in one of them, such as a plugin's `options` record and each option's config, `middleware`, or `views`, or the Application's `packet`, `rendering`, or `plugins`, that throws when read. A `plugin()` definition, or a plain object or list nested in it, that holds a key that is not enumerable, which core now reads where it ignored it before. A default's validator or an action that writes to an object default it receives.

**Why.** Core reads a declaration once, at the call that declares it, so every check, the graph, and every run read one copy. A read that throws now reports at that call, and the copy of a default that every reader shares is frozen so that no reader can change it for another.

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

1. Replace each getter or proxy in a declaration config and its default, a plugin definition, or a constructor's options, with the plain value it returns.
2. Change each validator or action that writes to an object default it receives so that it builds a new value instead.
3. Remove each key that is not enumerable from a `plugin()` definition and the values nested in it, unless core should read it.

**Validation.** Run `inspect()` on the Application in a test, and run each Command with no tokens so that every default passes through its validator and reaches its action. `inspect()` throws no `DeclarationError`, and no run reports `@loomcli/core/unreadable-declaration` or `@loomcli/core/validator-failed`.
