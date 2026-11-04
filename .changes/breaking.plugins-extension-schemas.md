- Change the published `schema` of the pack's extension descriptors from valibot's schema types to `StandardSchemaV1` over the exported facts interfaces: `helpCommand`, `helpInput`, and `helpArgument`; `manifestCommand`; `mcpCommand`, `mcpInput`, and `mcpArgument`; and `configInput`. No published declaration of `@loomcli/plugins` names valibot any longer, so an application's type check with `skipLibCheck: false` loads no valibot declarations through the pack. Validation is unchanged: every value the descriptors accepted before they accept now, with the same messages.

### Migration

**Affected surface.** Application code that reads a pack descriptor's `schema` as a valibot schema: it passes the schema to a valibot function such as `v.parse` or `v.InferOutput`, or reads a valibot member such as `entries`. A call of the descriptor, such as `helpCommand({ details })`, and a read through `readExtension` are not affected.

**Why.** A published type that named valibot loaded all of valibot's declarations into every author's type check. The descriptors now publish the [Standard Schema](https://standardschema.dev) contract, which every schema already implemented, over interfaces the pack exports, as the [public exports](docs/core/public-exports.md) page states.

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

**Steps.**

1. Replace each valibot type computed from a descriptor's `schema` with the exported facts interface: `HelpCommandFacts`, `HelpInputFacts`, `HelpArgumentFacts`, `ManifestCommandInput` and `ManifestCommandFacts`, `McpCommandFacts`, `McpInputFacts`, `McpArgumentFacts`, or `ConfigInputFacts`.
2. Replace each valibot call that takes a descriptor's `schema` with the schema's `~standard.validate`, which returns the output or the issues.

**Validation.** Run the application's type check, such as `tsc --noEmit`, and its tests. The type check reports every remaining use of a valibot member on a descriptor's `schema`.
