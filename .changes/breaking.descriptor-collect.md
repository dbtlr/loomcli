- Require every extension descriptor to publish `collect` as `true` or `false`. `AnyExtension` now includes `collect`, `extension()` publishes it, and build rejects a descriptor whose `collect` is missing or not a Boolean with `Extension "<identity>" declares collect that is not a Boolean. Supply true or false, or build the descriptor with extension(identity, config).`

### Migration

**Affected surface.** A plugin or application that lists a hand-built descriptor object, one not returned by `extension(identity, config)`, in a plugin's `extensions`, and TypeScript code that constructs an `AnyExtension` value by hand. Descriptors built with `extension()` are unaffected.

**Why.** A descriptor now says whether its values collect or replace each other, and build reads that flag for every descriptor it meets.

**Before and after.**

Before, a hand-built descriptor:

```ts
const notes = { identity: '@acme/notes/command', schema, target: 'command' };
```

After, built by the factory, which publishes `collect: false`:

```ts
import { extension } from '@loomcli/core';

const notes = extension('@acme/notes/command', { schema, target: 'command' });
```

**Steps.**

1. Find every descriptor object your code builds without calling `extension()`.
2. Replace each with `extension(identity, { schema, target })`, or add `collect: false` to the object.

**Validation.** Run the application's type check, then run `inspect()` or any command of the application. A remaining hand-built descriptor fails the build with the diagnostic above.
