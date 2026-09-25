- Change when a declaration fault throws. Every authoring call, both constructors, `plugin()`, and every `command()` attach throw `DeclarationError` the moment their data is known to be bad, so a JavaScript author's invalid declaration throws when its module evaluates, with a stack at the offending line, instead of being reported by `run()` or `inspect()`. Only the root's finished-Command rules, lifecycle hook faults, and a default its schema rejects still surface from `run()` or `inspect()`. Diagnostics keep their text, except that an invalid Command name now reads `Command name "bad name" is invalid. Use a nonempty name without a leading hyphen, whitespace, or "=".` from `new Command()`. See [Declaration faults](docs/core.md#declaration-faults).
- Change the Command graph to nest at most two levels below the root. `command()` on a named Command rejects a child that has children of its own: `Command "cache" attaches child "clear", which has children of its own. Nest Commands at most two levels below the root.` See [Nested Commands and groups](docs/core.md#nested-commands-and-groups).

### Migration

**Affected surface.** JavaScript authors, and TypeScript authors who pass values through `any`, whose declarations hold a fault; code that caught a declaration fault from `run()` or `inspect()`; and any application whose Command paths nest three or more levels below the root.

**Why.** A fault known at the call now throws where the author made it, rather than from a stack inside core during a run. A bounded depth keeps every Command path discoverable and every attach check local.

**Before and after.**

Before, the fault surfaced from `run()` as a diagnostic with exit code 1:

```js
const list = new Command('list').option('verbose', { multiple: true, type: 'boolean' });
await new Application('app').command(list).run(); // Invalid declaration: ...
```

After, the `option()` call throws when the module evaluates. A three-level path such as `app store cache clear` becomes `app cache clear`:

```js
const cache = new Command('cache').command(clear);
const app = new Application('app').command(cache);
```

**Steps.**

1. Fix each declaration fault the application's modules now throw at import.
2. Move any `try`/`catch` that expected a declaration fault from `run()` or `inspect()` to the call that makes the declaration.
3. Attach each group that sits below a named Command to a shallower parent, or flatten its children into it.

**Validation.** Import each module that builds the application and run its test command; no `DeclarationError` should throw, and `inspect()` should list every Command path at most two levels below the root.
