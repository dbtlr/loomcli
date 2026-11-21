- Change the configuration plugin to read JSON alone unless the application passes a reader for TOML or YAML in the new `formats` setting: `toml` from the new `@loomcli/plugins/config/toml` subpath reads `.toml` files, and `yaml` from the new `@loomcli/plugins/config/yaml` subpath reads `.yaml` and `.yml` files. The plugin no longer imports either parser itself, so an application that passes neither reader bundles neither `smol-toml` nor `yaml` (about 266 KB) and carries neither license. See [Configuration](docs/plugins/config.md#readers) and [ADR-0196](docs/decisions/0196-an-application-passes-the-toml-and-yaml-readers-it-reads-and-the-configuration-plugin-reads-json-alone-without-them.md).
- Add the `@loomcli/plugins/config/file-format` rule: a `file` that names a `toml`, `yaml`, or `yml` file, in a brace list or as a literal name, without its format's reader in `formats` throws at `configuration()`, naming the reader to pass.
- Change `*` in `file` to name the extensions of the readers passed, then `json` and `jsonc`. With no readers, `*` names `json` and `jsonc` alone.
- Change `--config` naming a `.toml`, `.yaml`, or `.yml` file the application does not read to fail with code 2, naming the file's format and the formats the application reads, as in `Option "--config": File "x.toml" is TOML, which this application does not read. Supply a JSON file.` A file the `env` variable names in such a format warns and the run reads no configuration. A file of any other name still reads as JSON.
- Change the `loom` bin to read JSON alone: `loom --config x.toml` now fails, and `@loomcli/loom` no longer bundles `smol-toml` or declares BSD-3-Clause.

### Migration

**Affected surface.** No compile error: `configuration()` throws a `DeclarationError` when the application starts, under `@loomcli/plugins/config/file-format`. The surface is a `configuration()` call whose `file` names a `toml`, `yaml`, or `yml` extension, in a brace list such as `.textstat.{toml,json}` or as a literal name such as `.textstat.yaml`. A call whose `file` has the extension `*`, or names only JSON files, compiles and starts unchanged, and so does a call with no `file`, which looks for `.<app>.json` and so names only a JSON file. Under `*`, a TOML or YAML file the walk used to find is no longer looked for, so its settings stop applying with no warning. Each of these stops reading TOML and YAML files at run time: an operator's `--config` naming a TOML or YAML file fails with code 2, and a TOML or YAML file the `env` variable names warns, or fails under `strict`.

**Why.** The plugin chose a parser at run time, so every application that installed it bundled both parsers whatever format it read. A reader the application passes keeps an unused parser out of the bundle.

**Before and after.**

Before:

```ts
import { configuration } from '@loomcli/plugins/config';
import { z } from 'zod';

export const config = configuration({
  file: '.textstat.{toml,json}',
  schema: z.object({ minBytes: z.number().optional() }),
});
```

After, passing the reader the file pattern names:

```ts
import { configuration } from '@loomcli/plugins/config';
import { toml } from '@loomcli/plugins/config/toml';
import { z } from 'zod';

export const config = configuration({
  file: '.textstat.{toml,json}',
  formats: [toml],
  schema: z.object({ minBytes: z.number().optional() }),
});
```

**Steps.**

1. Find each `configuration()` call: one whose `file` names `toml`, `yaml`, or `yml`, one whose extension is `*`, one whose `file` names only JSON files, and one with no `file`.
2. For `toml`, import `toml` from `@loomcli/plugins/config/toml` and add it to `formats`.
3. For `yaml` or `yml`, import `yaml` from `@loomcli/plugins/config/yaml` and add it to `formats`.
4. For `*`, add the reader of every format the application's operators may write, or neither to read JSON alone.
5. For a call whose `file` names only JSON files, or that passes no `file` and so looks for `.<app>.json`, add the reader of each format operators may name through `--config` or the `env` variable, or neither to read JSON alone.
6. If you pass `loom --config` a TOML file, convert it to `loom.config.json`.

**Validation.** Start the application, for example with `--help`, and check that it prints no `@loomcli/plugins/config/file-format` diagnostic. For each reader you added, run it with `--config` naming a file of that format and check that it reads the file's values. For an application that reads JSON alone, run it with `--config` naming a JSON file, and check that a TOML or YAML file fails with code 2. For a `*` pattern, put a file that the `file` pattern names in each format whose reader you passed in the working directory, and check that its values apply.
