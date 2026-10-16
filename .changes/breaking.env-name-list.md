- Allow an option to bind a list of environment variables, such as `env: ['AWS_REGION', 'AWS_DEFAULT_REGION']`. The first name in list order that holds a non-empty value supplies the option, an invalid Boolean or count value on it fails naming that variable, and a failure's source label names the variable that supplied the value. An empty list and a name repeated in one list are declaration errors, and a list claims every name it holds.
- Change the `env` fact on `OptionNode`, `inspect()`, and the manifest to an array of the bound variables in declaration order, empty when the option binds none. A binding declared as one name publishes a one-element array.

### Migration

**Affected surface.** Applications that read environment bindings from `OptionNode`, `inspect()`, or the manifest. Option declarations using one environment variable remain valid.

**Why.** An option can bind several names, so its published `env` fact is now a list instead of a string or `null`.

**Before and after.** Normalize no binding to an empty list and read all names in declaration order:

Before:

```ts
const names = node.env === null ? [] : [node.env];
```

After:

```ts
const names = node.env;
```

**Steps.**

1. Pin the first-party packages together at the same exact version.
2. Update inspection and manifest readers to accept an empty or populated array. Iterate all names, or read `env[0]` when only the first binding matters.
3. Update manifest schemas and snapshots that expect a string or `null`.

**Validation.** Run `pnpm exec tsc --noEmit` and the application's tests. Check inspection and manifest output for unbound, single-name, and multiple-name options.
