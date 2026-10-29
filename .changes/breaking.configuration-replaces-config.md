- Replace `config()` from `@loomcli/plugins/config` with `configuration()`. It takes one settings object that holds the required `schema`, a Standard Schema for the whole configuration file, beside the `file`, `short`, `env`, `directory`, and `notice` settings, and returns `{ plugin, values }`. Install `plugin`; a Command that opts in with `uses: [values]` reads the validated file as `provided.config`, typed as the schema's output. The `ConfigSettings` type is now `ConfigurationSettings`.
- Require the schema to accept an empty file. Its types reject a schema that requires a key outside an array item or a record value, and a schema that still rejects an empty file throws a `DeclarationError` under `@loomcli/plugins/config/empty-file`.
- Change a configuration value the schema rejects to be dropped instead of failing the run. The plugin removes the value at each issue's path and validates again, names each removal at `-v`, and ignores keys the schema does not describe. Only a `--config` file that is missing, cannot be read or parsed, or does not hold an object or mapping fails a run.
- Change a value a linked option cannot take, such as a string for a Boolean option, to fall through to the option's default with one `-v` line instead of failing the run with code 2.
- Change a linked option to take the value the file holds once the file passes the schema, and a relative path it takes to resolve against the directory of the file. `provided.config` keeps each path as the file wrote it.
- Add the build faults `@loomcli/plugins/config/link-path` and `@loomcli/plugins/config/link-type` for an option linked to a path that a schema publishing its shape through Standard JSON Schema does not hold, or that holds a value the option cannot take.

### Migration

**Affected surface.** Applications that call `config()` or import `ConfigSettings` from `@loomcli/plugins/config`, and applications that rely on a wrong-shaped configuration value failing the run with code 2.

**Why.** One schema describes the whole file, so application code reads structured configuration as `provided.config`, and a value the schema rejects is dropped so an operator's configuration never breaks a run.

**Before and after.**

Before:

```ts
import { Application } from '@loomcli/core';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';

const app = new Application('textstat', {
  plugins: [config({ file: '.textstat.{toml,json}', short: 'c' })],
}).option('min-bytes', { extensions: [configInput({ path: 'minBytes' })], type: 'string' });
```

After:

```ts
import { Application } from '@loomcli/core';
import { configuration } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { z } from 'zod';

const textstatFile = z.object({
  minBytes: z.union([z.number(), z.string()]).optional(),
  total: z.boolean().optional(),
});

const { plugin: configPlugin, values: config } = configuration({
  file: '.textstat.{toml,json}',
  schema: textstatFile,
  short: 'c',
});

const app = new Application('textstat', { plugins: [configPlugin] }).option('min-bytes', {
  extensions: [configInput({ path: 'minBytes' })],
  type: 'string',
});
```

A Command that reads the whole file opts in to the `values` the same call returns:

```ts
const show = new Command('show', { description: 'Show the threshold.', uses: [config] }).action(
  ({ out, provided }) => out.print(String(provided.config.minBytes)),
);
```

**Steps.**

1. Write one Standard Schema (zod, valibot, or ArkType) for the configuration file. Make every key optional outside an array item or a record value, or use a loose type such as `z.record(z.string(), z.unknown())` to keep the file loose. Keep the keys your `configInput` links read.
2. Replace `config(settings)` with `configuration({ ...settings, schema })`, install the returned `plugin`, and rename `ConfigSettings` to `ConfigurationSettings`.
3. Keep every `configInput({ path })` link. Fix a path that `@loomcli/plugins/config/link-path` or `@loomcli/plugins/config/link-type` reports at build.
4. Add the returned `values` to the `uses` list of each Command that reads the file's own values, and read them as `provided.config`.
5. Remove code or tests that expect a wrong configuration value to fail with code 2. Such a value now falls back and is named at `-v`.

**Validation.** Run `pnpm run build` and your type check, which fail where a schema requires a key outside an array item. Run the application with a configuration file that holds a wrong value and `-v` to see the `Ignored` line, then run your test suite.
