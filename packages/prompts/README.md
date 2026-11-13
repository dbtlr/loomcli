# @loomcli/prompts

Questions and progress lines for a Loom application. An action calls `text`, `secret`, `confirm`, `select`, `multiselect`, or `editor` to ask the operator a question at a terminal, and shows progress around its work. A question can be linked to an option or an argument, so the operator can give the answer on the command line instead. The library needs no plugin and registers no option; the optional `progressStyle()` plugin sets how progress lines look across the application.

## Install

```sh
pnpm add @loomcli/core @loomcli/prompts
```

## Use

```ts
import { Application, Command } from '@loomcli/core';
import { interaction } from '@loomcli/plugins/interaction';
import { confirm, select } from '@loomcli/prompts';
import { oneOf } from '@loomcli/validators';

const setup = new Command('setup')
  .option('backend', {
    type: 'string',
    validate: oneOf(['sqlite', 'postgres']),
    required: 'non-interactive',
  })
  .action(async (context) => {
    const backend = await select(context, {
      message: 'Storage backend',
      choices: ['sqlite', 'postgres'],
      option: 'backend',
      skipIfSupplied: true,
    });
    const install = await confirm(context, {
      message: 'Install the background service?',
      default: true,
    });
    // ...
  });

export const app = new Application('mimir', { plugins: [interaction()] }).command(setup);
```

## Documentation

The [prompts reference](https://github.com/dbtlr/loomcli/blob/main/docs/libs/prompts.md) documents each question kind and progress, and the [documentation map](https://github.com/dbtlr/loomcli/blob/main/docs/README.md) covers the rest of Loom.
