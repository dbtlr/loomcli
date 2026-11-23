# @loomcli/validators

The Loom validator catalog. Each factory, such as `port()`, `integer()`, `oneOf()`, `duration()`, or `path()`, returns an ordinary [Standard Schema](https://standardschema.dev/) value for an input shape a command-line application needs. An option or argument takes it in its `validate` slot, the action receives the typed value, and help, the manifest, and completion read the input schema it publishes. A schema library's value, such as a Zod schema, goes in the same slot.

## Install

```sh
pnpm add @loomcli/core @loomcli/validators
```

## Use

```ts
import { Application } from '@loomcli/core';
import { integer, oneOf, port } from '@loomcli/validators';

const app = new Application('serve')
  .option('port', { type: 'string', validate: port(), default: '8080' })
  .option('workers', { type: 'string', validate: integer({ min: 1, max: 64 }) })
  .option('mode', { type: 'string', validate: oneOf(['dev', 'prod']), default: 'dev' })
  .action(({ options }) => {
    const listen: number = options.port;
    const mode: 'dev' | 'prod' = options.mode;
    // ...
  });
```

`createValidator` builds your own validator the same way the catalog does, and `pipe` adds checks or transforms after one.

## Documentation

The [validators reference](https://github.com/dbtlr/loomcli/blob/main/docs/libs/validators.md) documents every factory and the issue codes each rejection carries, and the [documentation map](https://github.com/dbtlr/loomcli/blob/main/docs/README.md) covers the rest of Loom.
