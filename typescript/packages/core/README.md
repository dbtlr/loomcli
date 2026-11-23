# @loomcli/core

The core of Loom, a TypeScript toolkit for command-line applications. You declare an `Application` once, with its Commands, arguments, and options, and core parses each run, validates the inputs, calls the action, and renders its output and failures. Help, completion, the manifest, and MCP tools all read the same declaration.

Core installs no plugin by itself. Features such as `--help`, `--version`, and shell completion come from [`@loomcli/plugins`](https://www.npmjs.com/package/@loomcli/plugins), and the application lists the ones it wants.

## Install

```sh
pnpm add @loomcli/core
```

## Use

```ts
import { Application } from '@loomcli/core';

const app = new Application('paths')
  .argument('files', { variadic: true, required: true })
  .action(({ args, out }) => out.print(args.files.join('\n')));

await app.run();
```

## Related packages

- [`@loomcli/plugins`](https://www.npmjs.com/package/@loomcli/plugins): help, version, completion, configuration, MCP, and the other first-party plugins.
- [`@loomcli/validators`](https://www.npmjs.com/package/@loomcli/validators): Standard Schema validators for common input shapes.
- [`@loomcli/prompts`](https://www.npmjs.com/package/@loomcli/prompts): questions and progress lines an action shows the operator.
- [`@loomcli/testing`](https://www.npmjs.com/package/@loomcli/testing): the assembly check and test helpers.
- [`@loomcli/eslint-plugin`](https://www.npmjs.com/package/@loomcli/eslint-plugin): lint rules for a Loom application.
- [`@loomcli/loom`](https://www.npmjs.com/package/@loomcli/loom): the `loom` bin, which scaffolds, builds, and releases an application.

## Documentation

The [core reference](https://github.com/dbtlr/loomcli/blob/main/docs/core/README.md) documents every concept, and the [documentation map](https://github.com/dbtlr/loomcli/blob/main/docs/README.md) covers the rest of Loom.
