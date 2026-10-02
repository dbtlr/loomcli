- Add the rule `@loomcli/core/default-depth`. No path through a declared default may hold more than 10 arrays and plain objects, counted from the default itself, with a list or object the default holds twice counted on every path through it. `argument()`, `option()`, `globalOption()`, a lifecycle hook's `argument()` or `option()`, and `plugin()` for an option it declares throw a `DeclarationError` for a deeper default, such as `Option "deep" default nests deeper than 10 levels.`, on Node and Bun alike. Before, a default nested deeply enough to overflow the call stack reported `@loomcli/core/unreadable-declaration` with `Maximum call stack size exceeded`, and a shallower one could still overflow help or the manifest at run time. See [ADR-0053](docs/decisions/0053-a-declared-default-nests-at-most-ten-levels.md).

### Migration

**Affected surface.** A default passed to `argument()`, `option()`, `globalOption()`, a lifecycle hook's `argument()` or `option()`, or an option in a `plugin()` definition, that nests arrays and plain objects more than 10 levels deep.

**Why.** Every reader of the graph walks a default, and each one spends the call stack at its own rate on each runtime. One cap at the declaring call keeps every reader within the stack everywhere.

**Before and after.**

Before, the declaration was accepted:

```ts
app.option('tree', { default: [[[[[[[[[[['leaf']]]]]]]]]]], type: 'string', validate });
```

After, declare a flatter default and build any deeper structure in the action:

```ts
app.option('tree', { default: ['leaf'], type: 'string', validate });
```

**Steps.**

1. Find each default that nests arrays or plain objects more than 10 levels deep.
2. Flatten it, or declare the shallow value and build the deeper structure from it in the action.

**Validation.** Run `inspect()` on the Application in a test. It throws no `DeclarationError` with the rule `@loomcli/core/default-depth`.
