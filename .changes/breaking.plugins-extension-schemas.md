- Export a facts interface for each pack extension, the value its descriptor takes and the value `readExtension` reads back. `@loomcli/plugins/help/extension` exports `HelpCommandFacts`, `HelpInputFacts`, `HelpArgumentFacts`, `HelpSectionPath`, and `CommandExample`. `@loomcli/plugins/manifest/extension` exports `ManifestCommandInput` and `DeclaredFailureInput`, which an author supplies, `ManifestCommandFacts` and `DeclaredFailure`, which the schema outputs, and `CommandExample`. `@loomcli/plugins/mcp/extension` exports `McpCommandFacts`, `McpAnnotations`, `McpInputFacts`, and `McpArgumentFacts`. `@loomcli/plugins/config/extension` exports `ConfigInputFacts`.
- Allow read-only arrays in the values `helpCommand`, `helpInput`, and `manifestCommand` take, so a list declared `as const` or typed `readonly` passes as it is.
- Change the published `schema` of the pack's extension descriptors from valibot's schema types to `StandardSchemaV1` over the exported facts interfaces: `helpCommand`, `helpInput`, and `helpArgument`; `manifestCommand`; `mcpCommand`, `mcpInput`, and `mcpArgument`; and `configInput`. No published declaration of `@loomcli/plugins` names valibot any longer, so an application's type check with `skipLibCheck: false` loads no valibot declarations through the pack. Validation is unchanged: every value the descriptors accepted before they accept now, with the same messages.

### Migration

**Affected surface.** Application code that reads a pack descriptor's `schema` as a valibot schema: it passes the schema to a valibot function such as `v.parse` or `v.InferOutput`, or reads a valibot member such as `entries`. A call of the descriptor, such as `helpCommand({ details })`, and a read through `readExtension` are not affected.

The second affected surface is code that assigns to or mutates a value typed from a descriptor's input or output, such as `Parameters<typeof helpCommand>[0]` or `StandardSchemaV1.InferOutput<typeof helpCommand.schema>`. The facts are readonly at every depth now, so an assignment to one of their fields, a `push` on one of their lists, or reading one of their tuples or lists into a mutable-typed variable no longer compiles. Type such a value with the exported facts interface, and build it as a fresh object literal or a spread.

**Why.** A published type that named valibot loaded all of valibot's declarations into every author's type check. The descriptors now publish the [Standard Schema](https://standardschema.dev) contract, which every schema already implemented, over interfaces the pack exports.

**Before and after.**

Before:

```ts
import { helpCommand } from '@loomcli/plugins/help/extension';
import * as v from 'valibot';

type Facts = v.InferOutput<typeof helpCommand.schema>;
const facts = v.parse(helpCommand.schema, value);
```

After:

```ts
import { helpCommand, type HelpCommandFacts } from '@loomcli/plugins/help/extension';

const result = await helpCommand.schema['~standard'].validate(value);
if (result.issues === undefined) {
  const facts: HelpCommandFacts = result.value;
}
```

Code that built a facts value field by field builds it as one literal, and extends a list with a spread:

Before:

```ts
const facts: Parameters<typeof helpCommand>[0] = {};
facts.details = details;
facts.examples = [];
facts.examples.push({ command: 'notes add' });
```

After:

```ts
import { helpCommand, type HelpCommandFacts } from '@loomcli/plugins/help/extension';

const base: HelpCommandFacts = { details, examples: [] };
const facts: HelpCommandFacts = {
  ...base,
  examples: [...(base.examples ?? []), { command: 'notes add' }],
};
```

**Steps.**

1. Replace each valibot type computed from a descriptor's `schema` with the exported facts interface: `HelpCommandFacts`, `HelpInputFacts`, `HelpArgumentFacts`, `ManifestCommandInput` and `ManifestCommandFacts`, `McpCommandFacts`, `McpInputFacts`, `McpArgumentFacts`, or `ConfigInputFacts`.
2. Replace each valibot call that takes a descriptor's `schema` with the schema's `~standard.validate`, which returns the output or the issues.
3. Where code assigns to or mutates a value typed from a descriptor's input or output, type the value with the exported facts interface and build it as a fresh object literal or a spread.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its tests. The type check reports every remaining use of a valibot member on a descriptor's `schema`, and every assignment to a readonly facts value.
