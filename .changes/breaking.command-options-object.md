- Change `Command` to take one options object. `new Command(name, { globals })` replaces the positional `new Command(name, globals)` form, which no longer compiles and no longer builds.
- Add `description` and `version` as core facts. `description` is optional on the Application, on a Command, on an option, and on an argument, and holds a character other than whitespace and no line terminator. `version` is an optional string on the Application under the same rule, and a version that is not a string, is blank, or holds a line terminator fails build with `The Application version must be a string that holds a character other than whitespace and no line terminator. Supply a string such as "1.2.0".` Build validates both in `inspect()` and in `run()`.
- Add the facts to `inspect()`. `CommandGraph` reports `version` as a string, `0.0.0` when the Application declares none, which means unversioned, so a projection never branches on an absent version. It reports `description`, and each `CommandNode`, `ArgumentNode`, and `OptionNode` reports its own `description`, or `undefined` where the declaration omits one. The root `CommandNode` reports the Application's description, the value `CommandGraph.description` holds.
- Export the `CommandOptions` type from [core](docs/core.md#commands-and-global-options).

### Migration

**Affected surface.** Every `new Command(name, globals)` call that supplies a `GlobalOptions` value positionally. The Application constructor, the declaration calls, and every runtime behavior are unchanged.

**Why.** A Command now carries facts beside its globals, so its second argument is one options object, as the Application's already is. The retired form supplies a value that holds no `globals` key, so the globals would vanish silently and an operator, not the author, would meet the result as an unknown-option error.

**Before and after.**

Before:

```ts
import { Command } from '@loomcli/core';

import { globals } from '../globals.js';

export const get = new Command('get', globals).argument('path', { required: true }).action(getValue);
```

After:

```ts
import { Command } from '@loomcli/core';

import { globals } from '../globals.js';

export const get = new Command('get', { description: 'Reads one value.', globals })
  .argument('path', { required: true })
  .action(getValue);
```

**Steps.**

1. Replace each `new Command(name, globals)` with `new Command(name, { globals })`.
2. Leave `new Command(name)` unchanged, because a Command without globals still omits the second argument.
3. Add `description` to a Command, an option, or an argument, and `description` and `version` to the Application, where a projection needs them. Each fact is optional.
4. Read the new `inspect()` fields in any projection that renders the graph.

**Validation.** Run the application's type check to find each remaining positional call, which reports `Type 'GlobalOptions<...>' has no properties in common with type 'CommandOptions<...>'`. Run one invocation of a Command the application declares, such as `node ./your-cli.js get user.name`: a missed call reports `Invalid declaration: Command "get" takes an options object. Supply { globals } instead of a positional GlobalOptions value.` and exits with code 1. Run the application's test command to confirm the graph builds and dispatches.
