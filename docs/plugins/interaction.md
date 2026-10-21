---
description: "The interaction plugin: the operator's options for whether a run may ask."
---

# Interaction plugin

```ts
import { Application } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';

const app = new Application('mimir', { plugins: [interaction({ env: 'MIMIR_INPUT' })] });
```

`@loomcli/plugins/interaction` gives an application the switch that turns its [interaction decision](../core/interaction.md) off. `interaction(settings?)` declares one global Boolean option, `input`, with `polarity: 'negative'`, so the operator types `--no-input`, the description `Ask no questions, and take every answer from options.`, `control: true`, and the [mark](../core/interaction.md) `interaction: true`. It adds no middleware, no Command, no view, and no hook, and it claims no slot. A `required: 'non-interactive'` option and a [question](../libs/prompts.md) read the decision whether or not the plugin is installed; the plugin only gives the operator the spelling.

- **`env`.** The optional setting binds one variable name or a list, under the rules of [Input sources](../core/input-sources.md), so the configuration source and the environment can turn interaction off too. The variable states the option's value, so `MIMIR_INPUT=false` turns interaction off. Core derives no name, and the plugin adds none.
- **Another spelling.** An application that wants another spelling, or a positive option, leaves the plugin out and marks its own Boolean global option. Installing the plugin beside another marked option is a declaration error: [`@loomcli/core/interaction-mark`](../core/diagnostics.md#loomclicoreinteraction-mark).
- **Faults.** The typed settings reject a value of the wrong shape, and the factory judges none, under [Plugin settings](../core/plugin-contract.md#plugin-settings).
