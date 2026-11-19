---
description: "The configuration plugin: one configuration file per run described by one schema, read as provided.config and linked to options, and how the plugin finds it."
---

# Configuration plugin

This page documents the configuration plugin, which reads the one configuration file a run uses, validates it with the author's schema, hands the result to application code as a provided value, and fills the options linked to its keys. An author installs it so an operator can configure the application in a file.

```ts
// @loomcli/plugins/config
import type { Extension, Plugin, PluginOptionValues, Provider, StandardSchemaV1, StringOption } from '@loomcli/core';

type Short = NonNullable<StringOption['short']>; // one ASCII letter, as every option's short spelling is

/** unknown when the schema's input accepts an empty file, under The schema; ConfigurationSchemaMustAcceptAnEmptyFile otherwise. */
type EmptyFileGuard<Schema extends StandardSchemaV1> = /* under The schema */;

interface DirectorySetting<Name extends string> {
  /** The global option's name: 'project' declares --project. */
  readonly name: Name;
  /** Its short spelling, none by default. */
  readonly short?: Short;
  /** Its description. Defaults to 'Look for the configuration file from this directory.' */
  readonly description?: string;
}

/** Where the lookup looks: project is the walk, user the home file and the XDG user file. */
type Scope = 'project' | 'user';

interface ScopeSettings {
  /** The scopes the lookup reads, project before user whatever the order. Defaults to both. */
  readonly scopes?: readonly [Scope, ...Scope[]];
  /** The names whose presence stops the project walk after it looks in that directory, or false for none. */
  readonly root?: string | readonly [string, ...string[]] | false;
}

/** A format a reader reads beyond JSON: TOML reads .toml files, and YAML reads .yaml and .yml files. */
type ReaderFormat = 'TOML' | 'YAML';

/** The parser of one format beyond JSON, which an application passes in formats. Sealed: only the pack makes one, one per format. */
interface ConfigurationReader {
  readonly format: ReaderFormat;
}

interface ConfigurationSettings<Schema extends StandardSchemaV1, Directory extends string = never> extends ScopeSettings {
  /** One Standard Schema for the whole file. Every key is optional outside an array item or a record value. */
  readonly schema: Schema & EmptyFileGuard<Schema>;
  /** The configuration file's name or relative path, a file pattern. Defaults to `.<app>.json`. */
  readonly file?: string;
  /** The readers of the formats beyond JSON the application reads. None by default, so it reads JSON alone. */
  readonly formats?: readonly ConfigurationReader[];
  /** The short spelling of `--config`, none by default. */
  readonly short?: Short;
  /** A variable that names the configuration file, none by default. */
  readonly env?: string;
  /** A global option whose value is where the lookup's walk starts, none by default. */
  /** A directory option named config or no-config would claim the plugin's own spelling, so the type rejects it. */
  readonly directory?: DirectorySetting<Directory> & ([Extract<'config' | 'no-config', Directory>] extends [never] ? unknown : { readonly name: never });
  /** Write one line when the lookup finds no file. Off by default. */
  readonly notice?: boolean;
  /**
   * Fail the run, instead of dropping, for a value the schema rejects, an unknown key, or a linked
   * option's value: true for the whole file, or the dotted key paths at or under which one fails.
   * Either also fails the run, instead of warning, for a file the variable names or the lookup finds
   * that cannot be used. Off by default.
   */
  readonly strict?: boolean | readonly [string, ...string[]];
}

type ConfigOptions<Directory extends string = never> = {
  config: { control: true; description: string; type: 'string' };
  'no-config': { control: true; description: string; type: 'boolean' };
} & { [Name in Directory]: { description: string; type: 'string' } };

/** The provider of the validated configuration, read as provided.config. */
type ConfigProvider<Schema extends StandardSchemaV1, Directory extends string> = Provider<'config', StandardSchemaV1.InferOutput<Schema>, PluginOptionValues<ConfigOptions<Directory>>>;

interface Configuration<Schema extends StandardSchemaV1, Directory extends string> {
  /** The plugin the Application installs. */
  readonly plugin: Plugin<ConfigOptions<Directory>>;
  /** The validated configuration, read as provided.config. */
  readonly values: ConfigProvider<Schema, Directory>;
}

export declare function configuration<const Schema extends StandardSchemaV1, const Directory extends string = never>(
  settings: ConfigurationSettings<Schema, Directory>,
): Configuration<Schema, Directory>;

// @loomcli/plugins/config/extension, the declarations module. path is the dotted path the rules
// below state.
export interface ConfigInputFacts {
  readonly path: string;
}
export declare const configInput: Extension<'option', StandardSchemaV1<ConfigInputFacts, ConfigInputFacts>>;

// @loomcli/plugins/config/toml and @loomcli/plugins/config/yaml, one reader each.
export declare const toml: ConfigurationReader;
export declare const yaml: ConfigurationReader;
```

```ts
// src/configuration.ts
import { configuration } from '@loomcli/plugins/config';
import { toml } from '@loomcli/plugins/config/toml';
import { z } from 'zod';

const collectorConfig = z.object({
  minBytes: z.union([z.string(), z.number().int().nonnegative()]).optional(),
  sessions: z
    .object({
      sources: z.array(z.object({ harness: z.string(), dir: z.string().optional(), name: z.string().optional() })).optional(),
    })
    .optional(),
});

export const { plugin: configPlugin, values: config } = configuration({
  file: '.collector.{toml,json}',
  formats: [toml],
  short: 'c',
  env: 'COLLECTOR_CONFIG',
  directory: { name: 'project', short: 'p' },
  root: '.git',
  schema: collectorConfig,
});
```

```ts
// src/main.ts
import { Application, Command } from '@loomcli/core';
import { configInput } from '@loomcli/plugins/config/extension';
import { bytes } from '@loomcli/validators';

import { config, configPlugin } from './configuration.js';

const sources = new Command('sources', { description: 'List the transcript sources.', uses: [config] }).action(
  async ({ out, provided }) => {
    for (const source of provided.config.sessions?.sources ?? []) {
      await out.print(`${source.harness} ${source.dir ?? '(default)'}`);
    }
  },
);

const app = new Application('collector', { plugins: [configPlugin] })
  .option('min-bytes', {
    env: 'COLLECTOR_MIN_BYTES',
    extensions: [configInput({ path: 'minBytes' })],
    type: 'string',
    validate: bytes(),
  })
  .command(sources);
```

```toml
# .collector.toml
minBytes = 5

[[sessions.sources]]
harness = "claude"
dir = "../transcripts"
```

`configuration()` builds the configuration plugin and the provider that reads it from one settings object. The plugin answers the configuration tier of [Input sources](../core/input-sources.md) for the options linked to the file, and the provider hands application code the whole validated file as `provided.config`. Both read one file per run, found by the lookup below. [ADR-0118](../decisions/0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) records the schema, the provider, and the drop rule, [ADR-0154](../decisions/0154-the-configuration-plugin-names-at-v-each-key-the-published-json-schema-does-not-describe.md) the lines that name unknown keys, [ADR-0155](../decisions/0155-the-configuration-plugins-strict-setting-fails-the-run-for-a-value-at-or-under-a-path-it-lists.md) the `strict` setting, [ADR-0119](../decisions/0119-the-configuration-lookup-walks-to-home-reads-an-author-named-variable-and-the-xdg-user-file-and-never-falls-back-after-a-broken-file.md) the lookup, [ADR-0129](../decisions/0129-an-author-chooses-the-configuration-scopes-an-application-reads-and-a-root-marker-where-the-project-walk-stops.md) its scopes and root marker, [ADR-0153](../decisions/0153-a-process-handle-may-name-a-ceiling-the-configuration-walk-never-looks-above-and-a-mock-names-its-working-directory.md) the ceiling that ends its walk, [ADR-0054](../decisions/0054-the-configuration-plugin-reads-one-file-per-run-found-by-the-authors-file-pattern.md) the formats and the file pattern, and [ADR-0196](../decisions/0196-an-application-passes-the-toml-and-yaml-readers-it-reads-and-the-configuration-plugin-reads-json-alone-without-them.md) the readers an application passes for TOML and YAML.

## The plugin and its values

- **One call, two values.** `configuration(settings)` returns `{ plugin, values }`. The file pattern, the schema, and every other setting are written once, because a plugin's value is opaque and frozen and no plugin installs a provider, under [Providers](../core/providers.md). The Application installs `plugin`, and a Command that reads the configuration opts in to `values`.
- **The plugin.** Its identity is `@loomcli/plugins/config`. It declares the global options `--config` and `--no-config`, each marked `control: true`, the directory option when `directory` is set, the configuration source with the binding `configInput` and the file's schema, under **Publishing the schema**, and an [`onGraphBuilt`](../core/lifecycle-hooks.md#judging-the-built-graph) hook that judges links and the paths `strict` lists, and no middleware. Its source and its provider's opener load through `load` only when core calls them.
- **The provider.** `values` is an ephemeral provider named `config`. A Command opts in with `uses: [config]`, and its action reads `provided.config`, typed as the schema's output. The provider reads `--config` and the directory option as global options, so a Command that opts in fails to compile where it meets an Application that does not install `plugin`, under [Opting in](../core/providers.md#opting-in). Its value is the schema's output for the file once the file passes, under **Dropping values**, unless the read fails the run under **The strict setting**, and a run with no configuration file provides the schema's output for an empty file. The action cannot tell which file, or whether any file, supplied a value.
- **One read per run.** The source and the provider share one lookup, one read, and one validated result per run, so each warning and each `-v` line is written once, whichever reads first. The plugin keys the shared result by the run's `host`, the one object core hands both the source and the provider of a run. A run reads no file when no option needs a configuration value and the routed Command does not opt in, the one `--config` names included, and a takeover such as `--help` builds no provider. A nested `invoke` is a run of its own and reads again.

## Settings

- **`schema`.** Required: one Standard Schema for the file's top-level object, under **The schema**.
- **`file`.** The configuration file the lookup looks for. With none, the plugin looks for `.<app>.json`, where `<app>` is `graph.name`, which it reads when it runs, because `configuration()` cannot know the application name. `file` is a file name or a relative path, such as `.mimir.toml` or `.norn/config.toml`: a nonempty string that does not start with `/`, `\`, or a drive letter and a colon, and whose segments, split on `/` and `\`, are each nonempty and neither `.` nor `..`. Any other value throws a `DeclarationError` from `configuration()`: [`@loomcli/plugins/config/file-path`](../core/diagnostics.md#loomclipluginsconfigfile-path). The finding rebuilds the `configuration()` call and marks `file`.
- **`formats`.** The [readers](#readers) of the formats beyond JSON the application reads: `toml` from `@loomcli/plugins/config/toml` and `yaml` from `@loomcli/plugins/config/yaml`. With none, the application reads JSON alone. A reader passed twice counts once, and the order of the list changes nothing.
- **`short`.** Gives `--config` a short spelling under [Plugin settings](../core/plugin-contract.md#plugin-settings), so `short: 'c'` lets an operator type `-c`. With none, `--config` has no short spelling.
- **`env`.** Names a variable whose value names the configuration file, under **Lookup**. The plugin reads it from `host.env` itself: it is not an environment binding on `--config`, so `inspect()` publishes no `env` for it. The name follows core's variable name rule, `[A-Za-z_][A-Za-z0-9_]*`, and any other value throws a `DeclarationError` from `configuration()`: `@loomcli/plugins/config/variable-name`, `Plugin "@loomcli/plugins/config" env is not a variable name.`, corrected by `Name a variable such as COLLECTOR_CONFIG: a letter or an underscore, then letters, digits, or underscores.`
- **`directory`.** `{ name, short, description }` makes the plugin declare a global string option, `--<name>`, under **The directory option**. Core judges its name and short spelling as it judges every plugin option's, and the type rejects a `name` of `config` or `no-config`, which would claim `--config`'s or `--no-config`'s spelling.
- **`notice`.** With `true`, a run with no `--config`, no `--no-config`, and no variable whose search finds no file writes one line, under **Missing files**.
- **`strict`.** `true`, or a non-empty list of dotted key paths, under **The strict setting**: a value the schema rejects, an unknown key, or a linked option's value that it covers fails the run instead of dropping, and a file the variable names or the lookup finds that cannot be used fails the run instead of warning. `true` covers the whole file, and a list covers each path at or under a listed path. With none, or with `false`, nothing fails, and every byte the plugin writes is the same as without the setting. A listed path follows the rule of a link's path, under **The path**: it splits on `.`, each segment is one nonempty object key, and there is no escaping and no array indexing. Any other entry throws a `DeclarationError` from `configuration()`: `@loomcli/plugins/config/strict-path`, `Plugin "@loomcli/plugins/config" strict lists a path that is not a dotted path of nonempty keys.`, corrected by `List dotted paths of nonempty keys, such as delivery or delivery.webhook.` A path listed twice counts once, and a path under another listed path adds nothing.
- **`scopes`.** The scopes the lookup reads, under **Scopes**: a non-empty list of `'project'` and `'user'`. With none, the lookup reads both. The lookup reads the project scope before the user scope whatever order the list gives, and a scope listed twice counts once.
- **`root`.** The root marker, under **Scopes**: one name or a non-empty list of names whose presence in a directory stops the project walk after it looks in that directory. Each name is one path segment, nonempty, holding no `/` or `\`, and neither `.` nor `..`, and any other value throws a `DeclarationError` from `configuration()`: `@loomcli/plugins/config/root-name`, `Plugin "@loomcli/plugins/config" root is not a file name.`, corrected by `Name an entry in the project's root directory, such as package.json or .git.` `false` states that the project scope has no marker, and an omitted `root` walks the same way. A `root` other than `false` beside a `scopes` list without `'project'` throws `@loomcli/plugins/config/root-without-project`, `Plugin "@loomcli/plugins/config" root bounds a project walk the lookup never takes.`, corrected by `Add 'project' to scopes, or remove root.` The lint rule [`unrooted-configuration`](../libs/eslint-plugin.md#unrooted-configuration) warns on a call that reads the project scope with no `root`.
- **Faults at the call.** `configuration()` judges its settings when it is called: the `file` rules above and below, the reader rule last among them, then the `env` rule, then the `root` rules, then the `strict` rule. The types reject a `short` that is not one ASCII letter, an empty `scopes` list, a scope other than the two, an empty `root` list, and an empty `strict` list.

## The schema

```ts
type Input<Schema extends StandardSchemaV1> = StandardSchemaV1.InferInput<Schema>;

/** The keys a type declares, without its index signatures. */
type DeclaredKeys<Value> = {
  [Key in keyof Value as string extends Key ? never : number extends Key ? never : symbol extends Key ? never : Key]: Value[Key];
};

/** true when every declared key of every object reachable through declared keys is optional; array items and index-signature values are not entered. */
type KeysOptional<Value> = Value extends readonly unknown[]
  ? true
  : Value extends object
    ? {} extends DeclaredKeys<Value>
      ? false extends { [Key in keyof DeclaredKeys<Value>]-?: KeysOptional<Exclude<DeclaredKeys<Value>[Key], undefined>> }[keyof DeclaredKeys<Value>]
        ? false
        : true
      : false
    : true;

type EveryKeyOptional<Schema extends StandardSchemaV1> = {} extends Input<Schema> ? KeysOptional<Input<Schema>> : false;

/** The type error's own words: tsc names this interface and its one key. */
interface ConfigurationSchemaMustAcceptAnEmptyFile {
  readonly 'Make every key optional outside an array item or a record value': never;
}
type EmptyFileGuard<Schema extends StandardSchemaV1> = EveryKeyOptional<Schema> extends true ? unknown : ConfigurationSchemaMustAcceptAnEmptyFile;
```

- **One schema for the whole file.** `schema` describes the file's top-level object, every section included. Application code reads its output, and a linked option reads the file's values at its path, under **Linking an option**. An author who wants a loose file writes loose types, such as a record of unknown values.
- **An empty file passes.** A command-line application runs before its operator has written any configuration, so the schema's types accept only a schema whose input accepts an empty file: every object key is optional at every depth outside an array item and a record's values. A key with a schema default is optional. Inside an array item a key may be required, because an item is a unit: a `[[sessions.sources]]` entry without `harness` is not a source. A record's value is a unit the same way. A schema that requires a key elsewhere fails to compile at the `configuration()` call, and so does a schema whose top level is not an object: tsc reports that the schema lacks the key `Make every key optional outside an array item or a record value` of `ConfigurationSchemaMustAcceptAnEmptyFile`. A declared key beside an index signature is judged like any other, so a loose object, such as zod's `looseObject` or an object with a `catchall`, that requires a key fails to compile, while a record, which declares no key, is not entered. The rule holds at every depth, not only at the top: `updates?: { channel: string }` accepts an empty file, but a file that holds `[updates]` with no `channel` would lose the whole table, so it fails to compile. A union at an object key is judged by each member, so a discriminated union there, whose discriminant is a required key, fails to compile; an author puts one in an array or a record, or makes the discriminant optional. A schema whose input is `unknown` or `any` passes, as a loose schema does. The rule reads the schema's input type alone, and it holds alike for zod, valibot, and ArkType, with or without `exactOptionalPropertyTypes`. In ArkType, a key whose object holds only defaults is still required unless the key itself is optional, `'updates?': { interval: 'number = 5' }`.
- **A schema that rejects an empty file.** The types cannot see a refinement, so a schema may still reject an empty file, such as a refinement on the top-level object that fails for `{}`. When the drop rule has removed every key and the schema still reports issues, the schema is the author's defect: the plugin throws a `DeclarationError` under `@loomcli/plugins/config/empty-file`, `The configuration schema rejects an empty file: <message>.`, corrected by `Make every key optional, and keep every refinement true for an empty file.`, where `<message>` is the first issue's. It is a `LoomError`, so it reports as itself with code 1 from the source, under [When author code fails](../core/input-sources.md#when-author-code-fails), and from the provider through the ordinary failure path: the Developer Diagnostic in a development build and the generic defect message in a distributed one. A run with no file meets it on its first read, so the author meets it on the first run.
- **What the schema reads.** The plugin validates the document as it parses it, under **Reading**: a TOML date or time as the text the file wrote, a TOML integer beyond `-(2^53 - 1)` through `2^53 - 1` as a `bigint`, and a YAML alias as the value its anchor names. It awaits a schema whose `validate` returns a promise.
- **Unknown keys.** A key the schema does not describe never fails a run and is never reported at the default verbosity, unless `strict` covers it, under **The strict setting**. Where the schema publishes a JSON Schema, the plugin names it at `-v`, under **Naming unknown keys**. Whether it reaches `provided.config` is the schema library's choice for a loose object.
- **A section the schema keeps as `unknown`.** A key whose schema accepts any value, such as `z.unknown().optional()`, has nothing to reject, so no issue names it, and its value reaches `provided.config` exactly as the file wrote it, nested tables and arrays included, unless the drop rule removes a value that holds it, such as its array item. This is how an author keeps their own parser for one section: the schema describes the rest of the file, and the action parses the section itself. The section adds nothing to the published JSON Schema beyond the key's name: it lists the key with the empty schema `{}`, which accepts any value, and describes nothing below it, so an editor offers no completion or validation there. Write `.optional()` on the key: zod treats a bare `z.unknown()` key as required, so the schema's types reject it under **An empty file passes**, and its published JSON Schema would list it as required.

  ```ts
  const { plugin, values } = configuration({
    schema: z.object({
      name: z.string().optional(),
      // The action parses this section with the application's own parser.
      extras: z.unknown().optional(),
    }),
  });
  // A file holding { "name": 7, "extras": { "a": [1, { "b": 2 }], "flag": "yes" } } provides
  // { extras: { a: [1, { b: 2 }], flag: 'yes' } }: the wrong `name` is dropped, `extras` is untouched.
  // The published schema's properties are name: { type: 'string' }, extras: {}, and the $schema pointer.
  ```

- **Strict objects.** zod reports an unknown key in a strict object as an issue on the object itself, so the drop rule removes the whole object. The types cannot tell a strict schema from a loose one, so `@loomcli/eslint-plugin`'s [`strict-configuration-schema`](../libs/eslint-plugin.md#strict-configuration-schema) rule advises against a zod strict object. valibot and ArkType name the unknown key, so the drop rule removes that key alone. An author who turns the rule off gets what the schema reports, under the ordinary drop rule.

## Publishing the schema

```jsonc
// The manifest's envelope for the collector above, abridged: core derives the JSON Schema at graph build.
"configuration": {
  "schema": {
    "$schema": "https://json-schema.org/draft/2020-12/schema",
    "type": "object",
    "properties": {
      "minBytes": { "anyOf": [{ "type": "string" }, { "type": "integer", "minimum": 0 }] },
      "sessions": { "type": "object", "properties": { "sources": { "type": "array" /* … */ } } },
      "$schema": { "type": "string" }
    }
  }
}
```

- **Core publishes the JSON Schema.** The plugin passes its schema to core as the configuration source's `schema`, so the graph's `configuration.schema` is the file's input-side JSON Schema, derived at graph build under [Input sources](../core/input-sources.md), and the [manifest](manifest.md) prints it. An application publishes it by installing the plugin, with no other call. A schema whose library publishes no converter, such as valibot's, publishes `null`, and so does one whose converter fails for a part JSON Schema cannot express, such as zod's `z.bigint()` or `z.date()`: core reports no fault for it, so the run goes on. [ADR-0121](../decisions/0121-the-configuration-source-publishes-its-files-json-schema-as-a-core-graph-fact.md) records the decision.
- **The schema the plugin passes.** The plugin passes a Standard Schema that wraps the author's. When the author's schema has no converter, the wrapper has none either. Otherwise its converter calls the author's and lists the pointer in a copy of the answer, so the object the library returned is never changed; a converter that throws, or that returns anything but an object, reaches core untouched, which publishes `null` for it under [Input sources](../core/input-sources.md). The wrapper reads the author's standard properties only when core asks, never at the `configuration()` call.
- **A `$schema` property.** The copy lists `"$schema": { "type": "string" }` among the `properties` of its top-level object, so an editor that validates the file accepts the pointer. A top level that is a `$ref` into its own `$defs` lists it in the definition it names. A top level that describes an object with no `properties`, such as a record, gains `properties` with the pointer alone. A `$schema` property the author's schema already declares is kept as the author wrote it. A union, an `allOf`, and any other top level are published as they are.
- **A `$schema` key in the file.** The plugin removes a top-level `$schema` key from the file it read, in every format, before it validates. The key never reaches `provided.config`, even when the author's schema declares it, never meets a strict schema, writes no `-v` line, and answers no link. A `$schema` key below the top level is an ordinary key.
- **Hosting is the author's.** Loom writes no schema file and hosts nothing. An author who wants editors to validate the file hosts the manifest's `configuration.schema` at a URL of their choice.
- **The pointer.** Code that writes a configuration file for the operator, such as an application's own `init` Command, writes the pointer to the hosted schema: a top-level `"$schema": "<url>"` key in JSON, a first line `#:schema <url>` in TOML, which Taplo reads, and a first line `# yaml-language-server: $schema=<url>` in YAML. The plugin writes no configuration file.

## Dropping values

A value in the file never fails a run, unless `strict` covers it, under **The strict setting**. The plugin removes what the schema rejects and keeps the rest.

- **Drop and validate again.** The plugin calls the schema's `~standard.validate` with the parsed file, less its top-level `$schema` key under **Publishing the schema**. When the result holds issues, it removes the value at each issue's path and validates again, until the file passes. Each round removes at least one value, so the loop ends.
- **What a path removes.** A path segment is a key, or `{ key }` as Standard Schema allows. The plugin reads every issue's path against the file as it stood when the round began, and the line that names a value reads an array item's index as its position in the file as read, under **Named at `-v`**. A path that passes through an array item is cut at the outermost item it enters, and the whole item is removed, so an item with a missing required key or a wrong value at any depth below it is gone and the array keeps its other items. Any other path that ends at a value the file holds removes that value. A path that ends at a value the file does not hold, such as a missing key, removes the nearest enclosing value the file holds. A path with no segments removes every key, and the file then validates as an empty file. A target inside a value the same round already removes is skipped, and the plugin removes array items from the highest index down, so a removal never moves another target.
- **Records.** At run time the plugin cannot tell a record from an object, so a wrong value inside a record's value removes that value alone. When the record's value then lacks a key it requires, the next round removes the whole entry and writes a second `-v` line for it.
- **Where libraries put a path.** zod, valibot, and ArkType name the same path for a wrong value, a missing key in an array item, an array item, and a refinement on a nested object. A refinement on the top-level object has no path in all three, so it removes every key. A strict object differs: valibot and ArkType name the unknown key itself, while zod names the object that holds it, so one unknown key empties a zod strict object, the whole file at the top level. The [`strict-configuration-schema`](../libs/eslint-plugin.md#strict-configuration-schema) rule advises against strict objects for this reason.
- **Fallbacks.** A key whose value is removed falls back to its schema default, or to absence, in `provided.config`. A linked option whose value is removed has no answer from the source and falls through to its default.
- **Named at `-v`.** Each removed value logs one `log.debug` line, which shows at `-v` and above: `Ignored updates.interval in .collector.toml: <message>`, naming the removed key's path, with an array item as its index in brackets, `sessions.sources[2]`, the file as its labels show it, and the first issue's message for that path. An array item's index is its position in the file as read, in every round, even when an earlier round removed an item before it, so one run names an item one way in every line. A whole file removed reads `Ignored every key in .collector.toml: <message>`. A run with no file validates an empty file and writes no line. The message is the schema's own, so the line quotes what the author's schema reports, and the plugin escapes control characters in it as it escapes paths. A removed value that `strict` covers writes no line and fails the run instead, under **The strict setting**.

## Naming unknown keys

An unknown key is a key the file holds that the configuration schema does not describe, such as `state_dir` written for `stateDir`. It never fails a run unless `strict` covers it, under **The strict setting**, and naming it removes nothing from the file. Where the schema publishes a JSON Schema, the plugin names each unknown key at `-v`, so an operator who sees a setting have no effect learns that the application did not read it.

```toml
# .collector.toml, read by the collector above, whose zod objects are plain objects.
state_dir = "/var/lib/collector"

[[sessions.sources]]
harness = "claude"
nmae = "work"
```

```text
Ignored state_dir in .collector.toml: Unknown key. Check its spelling, or remove it.
Ignored sessions.sources[0].nmae in .collector.toml: Unknown key. Check its spelling, or remove it.
```

- **The line.** Each unknown key logs one `log.debug` line, which shows at `-v` and above and never at the default verbosity: `Ignored <path> in <file>: Unknown key. Check its spelling, or remove it.` The line is built as a dropped-value line is, under **Dropping values**: `<path>` is the key's path, its keys joined by dots, never quoted, and an array item as its position in the file as read in brackets, as **Named at `-v`** states, so a flat key `updates.channel` that the schema does not list at the top level reads as the path of a nested key, as it does in a dropped-value line, and `<file>` is the file as its labels show it. The sentence after the colon is fixed. Each character [`escapeControlCharacters`](../core/styles.md#strings-and-composition) escapes in the path or the file prints as that escape, under **Text**, so a key that holds a newline stays on one line. A key that cannot be seen is the exception to "never quoted", under **A key that cannot be seen**.
- **A key that cannot be seen.** A key that is empty, has whitespace at an edge, or holds a character a reader cannot see would print as a line that reads like a correctly spelled key, or names nothing. Such a key prints in double quotes, with each unseen character as its code point: `U+` and at least four uppercase hexadecimal digits, with no space or delimiter around it. The rule is one function, `shownUnknownPath`, and it applies to this line alone, in `-v` output and in the failure's problems under **The strict setting**, because both are built from one path. Every other key keeps its bytes, and so does every other line the plugin writes.
  - **An unseen character** is a format character of Unicode category Cf, such as the zero-width space U+200B, the byte order mark U+FEFF, and the soft hyphen U+00AD, a space separator of category Zs other than the ordinary space, such as the no-break space U+00A0, and any whitespace character in the run at either edge of the key, an ordinary space included. A control character, a line or paragraph separator, and a bidirectional control stay as the line already shows them, as the escape `\uXXXX` under **Text**. Inside a key, such a character does not quote the key. At an edge, such a character that is whitespace, such as a tab, a newline, or a line separator, is whitespace at an edge, so the key is quoted and the character keeps its escape inside the quotes; one that is not, such as an escape character or a bidirectional control, does not quote the key. An ordinary space inside a key is visible, so it stays a space, and a key that holds a dot is not quoted for the dot: it reads as a nested path, as this section states.
  - **Inside the quotes.** A double quote prints as `\"` and a backslash as `\\`, so the closing quote is the one that ends the key. A key that holds the text `U+200B` itself prints it as it is, so the code point form is a reading aid and not an encoding. A key that is not quoted prints its quote or backslash as it is.
  - **Why this line alone.** Core leaves format characters raw in a quoted diagnostic, as rule 5 of the [failure message voice](../core/failures.md#failure-message-voice) states, because an emoji's joiner or a soft hyphen is ordinary text there. This line exists to show a misspelling, and a key that differs from the one the author wrote only by a character no reader sees defeats it, so the plugin shows the code point here and changes no rule of core.

  ```text
  Ignored "stateU+200BDir" in .collector.toml: Unknown key. Check its spelling, or remove it.
  Ignored updates."U+0020chanel" in .collector.toml: Unknown key. Check its spelling, or remove it.
  Ignored "" in .collector.toml: Unknown key. Check its spelling, or remove it.
  ```

- **The order.** The lines follow every line the drop rule writes for a value the schema removed. The lines the source writes for a value a linked option cannot take, and the line core writes for a value a validator rejects, come after the read returns, so they follow the unknown-key lines. The unknown-key lines come in the order the parsed file lists its keys, depth first: an object's keys in order, each key's line or the lines below it before the next key's, and an array's items from the first. The parsed file lists its keys as a JavaScript object does, so a key that is a whole number, such as `10`, comes first in its object.
- **The JSON Schema decides.** The plugin judges the file against the graph's `configuration.schema`, the JSON Schema core published at graph build, under **Publishing the schema**, the one the link check reads. It never compares the file with `provided.config`, and it never reads a schema library's own shape.
- **What the line trusts.** The line trusts the input schema the library publishes. Input-side rewriting that schema does not show, such as a `z.preprocess` that reads a legacy key the published schema omits, can name a key the application read. An author who keeps such a key lists it in the schema, or keeps the section open.
- **No JSON Schema, no line.** A schema whose library publishes no converter, such as valibot's, and one whose converter fails, such as zod's for `z.bigint()` or `z.date()`, publish `null`, under **Publishing the schema**. Under such a schema no unknown key prints a line, at any verbosity, in any run.
- **What the plugin walks.** It walks the file as it read it, less its top-level `$schema` key, from the top-level object down, judging each value against the shapes the JSON Schema gives it. The top-level object stands for the published schema's top level. Each shape is read by the keywords **A link the schema cannot hold** reads, and through the same walk the link check uses: a `$ref` to the shape's own `$defs` is followed, and `allOf`, `anyOf`, and `oneOf` stand for each of their members.
- **A key of an object.** At each key of an object the file holds, the plugin judges every shape the object stands for, and the key comes to one of three outcomes:
  - **Unchecked.** Any of those shapes describes an array, names no keyword but annotations, or is open and does not list the key. Nothing at or below the key prints.
  - **Unknown.** Otherwise, no shape lists the key in its `properties`. The key prints its line, and nothing below it is walked.
  - **Described.** Otherwise, its value is walked against the shapes the listing shapes give the key.

  So for a path with no array item and no key that holds a dot, a key is unknown exactly when a link to its path fails `link-path`: the walk judges a key that holds a dot, such as a flat `updates.channel`, as the one key it is, while a link splits its path on dots. And the walk enters a listed key whether its object is open or not.
- **Open objects.** An object is open when it has `additionalProperties` or `patternProperties` with a value other than `false`, as the link check holds. A record, zod's `looseObject`, and an object with a `catchall` are open, so none of their unlisted keys prints, and nothing below one prints either. A section kept as `z.unknown()` or `z.any()` publishes a shape with no keyword, so nothing in it prints. zod's and ArkType's plain objects name neither keyword, so they are closed and their unknown keys print.
- **Array items.** At an array the file holds, the plugin walks each item against, for each shape the array stands for that describes an array, its `prefixItems` entry at the item's index when it names one, and its `items` otherwise. A shape that names neither, or whose entry is not an object or names no keyword but annotations, takes any item, so nothing in that item prints. A shape the array stands for that names no keyword but annotations leaves every item unchecked, a shape that describes no array takes no part, and when none of the shapes describes an array the items are not walked. A shape describes an array as the link check reads it: its `type` is `array`, or it names `items` or `prefixItems`. So `sessions.sources[0].nmae` prints for a source table that misspells `name`, and an item inside an array item is walked the same way.
- **Other values.** A string, a number, a Boolean, and a null hold no key, so nothing below them is walked.
- **A value inside itself.** A YAML alias inside the anchor it names makes a value its own ancestor. The plugin does not enter such a value again below itself, so the walk ends. A value two aliases share at different paths is walked at each path, so an unknown key in it prints once for each.
- **Dropped values.** The plugin enters no value the drop rule removed, so a key at or below a dropped value prints no line of its own: the dropped-value line names the value that holds it. One unknown key in a zod strict object removes the object, so `Ignored updates in .collector.toml: <message>` is the object's one line, and a strict object whose library names the unknown key itself, as ArkType's does, removes the key, so the dropped-value line is that key's one line. An unknown key beside a dropped value in the same object prints its own line. An array item's index is its position in the file as read, even when the drop rule removed an item before it, in this line and in a dropped-value line alike.
- **`$schema`.** The top-level `$schema` key is removed before the walk, under **Publishing the schema**, so it never prints, whether or not the published schema lists it. A `$schema` key below the top level is an ordinary key, so a closed object that does not list it names it.
- **When the lines print.** The lines belong to the run's one read, under **One read per run**, so a run names its unknown keys once, whichever reader reads first, and a nested `invoke` reads again and names them again. A file `--config` names and a file the lookup finds print alike. A run that reads no file, a run under `--no-config`, a run whose file is missing or broken, and a takeover such as `--help` print none.
- **Nothing else changes.** An unknown key is not a dropped value. Whether it reaches `provided.config` is the schema library's choice, as **The schema** states: a zod plain object strips it, and a loose object keeps it. It answers no link, because a link to a path the schema does not hold fails at graph build. The line is stderr text for the operator alone: it creates no [log event](../core/logging.md), appears in no result, failure, or manifest field, and changes no exit code. An unknown key that `strict` covers writes no line and fails the run instead, under **The strict setting**.

## The strict setting

Some applications run where no operator reads `-v`, such as a service that systemd or launchd supervises. For them, `strict` makes the drop rule fail the run for the part of the file the author chooses. A value the schema rejects, an unknown key, or a linked option's value that `strict` covers fails the run with code 2, and one failure names every such key with its file. A file the run cannot use fails it too, under **A broken file**. The plugin drops everything the setting does not cover, as **Dropping values** states.

```ts
// src/configuration.ts, for a collector that a supervisor runs, where nobody reads -v.
import { configuration } from '@loomcli/plugins/config';
import { toml } from '@loomcli/plugins/config/toml';
import { z } from 'zod';

const collectorConfig = z.object({
  delivery: z
    .object({ retries: z.number().int().nonnegative().optional(), webhook: z.string().optional() })
    .optional(),
  minBytes: z.union([z.string(), z.number().int().nonnegative()]).optional(),
});

export const { plugin: configPlugin, values: config } = configuration({
  file: '.collector.toml',
  formats: [toml],
  schema: collectorConfig,
  strict: ['delivery'],
});
```

```ts
// src/main.ts
import { Application } from '@loomcli/core';
import { configInput } from '@loomcli/plugins/config/extension';
import { bytes, url } from '@loomcli/validators';

import { configPlugin } from './configuration.js';
import { sources } from './sources.js';

const app = new Application('collector', { plugins: [configPlugin] })
  .globalOption('min-bytes', { extensions: [configInput({ path: 'minBytes' })], type: 'string', validate: bytes() })
  .globalOption('webhook', {
    extensions: [configInput({ path: 'delivery.webhook' })],
    type: 'string',
    validate: url({ protocols: ['https'] }),
  })
  .command(sources);
```

```toml
# .collector.toml
state_dir = "/var/lib/collector"

[delivery]
retries = "three"
webhok = "https://alerts.example.com/hook"
```

```text
$ collector sources
collector: Configuration value delivery.retries in .collector.toml: Invalid input: expected number, received string. Correct the value, or remove it.
collector: Unknown key delivery.webhok in .collector.toml. Check its spelling, or remove it.
$ echo $?
2
```

`state_dir` lies outside `delivery`, so it stays a `-v` line, `Ignored state_dir in .collector.toml: Unknown key. Check its spelling, or remove it.`, which `-v` prints above the failure. Under `strict: true` the failure names it too, in the walk's order: `collector: Unknown key state_dir in .collector.toml. Check its spelling, or remove it.` comes between the two lines above. Once the operator corrects both keys, a `webhook = "http://alerts.example.com/hook"` that the schema accepts and the option's validator rejects fails the run in core's validation, `collector: Option "--webhook" (from delivery.webhook in .collector.toml): Expected an absolute URL with the scheme https.`, with code 2. Both options are global, so a run that routes to `sources` asks the source about them, as **Linking an option** states. A local option of the root is out of scope on `sources`, and the source is never asked about it.

- **What a list covers.** `strict: true` covers the whole file and every linked option. A list covers each path at or under a listed path. A path is at or under a listed path when the listed path's segments are its first steps, each step an object key equal to its segment. So `strict: ['delivery']` covers `delivery`, `delivery.retries`, and `delivery.targets[0].url`, and not `deliveryMode`. A key that holds a dot is one step, so a flat `"delivery.webhook"` key at the top level is not under `delivery`, although its line reads as the nested path. An unknown key is covered when its own path is at or under a listed path. A value the schema removes fails the run when an issue behind the removal names a path at or under a listed path, or when the removal discards a value the file holds at a listed path. The issues behind a removal are each issue whose value the drop rule removes with it. The drop rule cuts an issue's path at an array item, or at the nearest value the file holds, under **Dropping values**, so a removal can land above the path its issue names. Two examples under `strict: ['delivery.webhook']`, with `webhook` required inside an optional `delivery` section:
  - **A missing required key at a listed path.** A file that writes `[delivery]` without `webhook` fails the run. The schema's issue names `delivery.webhook`, which the file does not hold, so the drop rule removes `delivery`, and the issue behind that removal is at the listed path.
  - **A section-level refinement that removes a section holding a listed key.** A refinement on `delivery` that fails, such as one that asks for `backoff` whenever `retries` is set, names `delivery`, so the drop rule removes the section. When `delivery.webhook` holds a value, even one the schema accepts, the removal discards it, and the run fails.

  A removal of a value that holds a listed path discards nothing there when the file holds nothing at that path, so it drops as **Dropping values** states and is named at `-v`. The same refinement on a section without `webhook` drops `delivery`, and so does a `delivery = 5` that the schema rejects at `delivery`. List the section itself when its own value must be judged. An array item's index equals no segment, so a listed path never reaches below an array, and the build check rejects a path that passes through one, under **A listed path the schema cannot hold**. To cover an array, list its own key, such as `sessions.sources`, and an issue inside each of its items is covered. A removal of every key discards each listed path's value, so under a list it fails the run when the file holds a value at a listed path. A misspelled section, such as `[delivry]`, is an unknown key outside `delivery`, so only `strict: true` fails the run for it.
- **The drop rule still runs.** The plugin runs the drop rule and the unknown-key walk over every round, as **Dropping values** and **Naming unknown keys** state. A covered removal is one that fails the run under **What a list covers**, judged on the file of the round that removes it, and a covered unknown key is one whose own path is covered. Each covered removal and each covered unknown key is held for the failure and writes no `-v` line. Every other value writes its `-v` line as before, in the same order. When the read holds any value or key once the walk ends, the run fails, so one failure names every covered value and key the file holds, whichever round finds it. A removal that the schema reports only after a covered value has gone is held too, as it would write a second `-v` line. An example is a record entry that lacks a required key once a wrong value inside it is removed.
- **Unknown keys need a JSON Schema.** The plugin learns that a key is unknown only from the published JSON Schema, under **Naming unknown keys**. A schema whose library publishes no converter, such as valibot's, and one whose converter fails, such as zod's for `z.bigint()`, give `strict` no unknown key to fail on, at any path. A value such a schema rejects still fails the run. An author who wants an unknown key to fail the run under such a schema writes a strict object, such as valibot's `strictObject`, so the schema itself reports the key and the drop rule removes it. A zod strict object reports the key on the object, so a covered one fails the run on the object's path, and the [`strict-configuration-schema`](../libs/eslint-plugin.md#strict-configuration-schema) rule still advises against it.
- **Linked options.** A linked option is covered when `strict` is `true`, or when its `configInput` path is at or under a listed path, so `strict: ['delivery']` covers an option linked at `delivery.webhook`. The source reads each request's value in order, as **Linking an option** states. A covered option's value that the option cannot take, under **A value the option cannot take**, writes no `-v` line and joins the failure as that option's own problem. An uncovered option's value writes its line as before. An answer for a covered option carries `strict: true`, under [Input sources](../core/input-sources.md#configuration-sources). So a value that its validator rejects fails the run in core's validation phase, with core's diagnostic for a filled value, instead of falling back, and core writes no `-v` line for it. Core validates only after the source returns, so such a rejection fails the run only when the source threw nothing, which means the read held no value or key and no covered option's value was one the option cannot take. A source failure takes the place of every problem collected, so a run that holds both reports only the source's failure, and the validator's rejection shows on the next run. A linked option that argv or the environment supplies is not requested, so its value in the file fails the run only through the schema.
- **The failure.** The source throws an `InputError`, or the provider throws it when the provider reads first. It is the failure class of a broken `--config` file, under **The named file**. Its code is 2, and `--help` reports nothing, as [Input sources](../core/input-sources.md) holds every source `InputError`. A provider's `InputError` takes the ordinary failure path from the dispatch boundary with the same code. When the provider reads first, no option is requested, so the failure holds the file's problem alone. Its problems come in this order:
  - **The file's problem**, present when the read held a value or a key, or found a broken file: `{ input: { kind: 'option', name: 'config', global: true }, spelling: '--config', reason: 'invalid', issues }`. It holds one issue, `{ message }`, for each held removal, in the order the drop rule removed them, and then one for each held unknown key, in the walk's order, or, for a broken file, its one issue. The problem names `--config`, the plugin's option for the configuration file, whichever of `--config`, the variable, or the lookup found the file, as the problem for a broken named file does. In an [invocation by name](../core/invocation.md#invocation-by-name) it spells the option `config`.
  - **A linked option's problem**, one for each covered option whose value the source could not take, in the order of the requests: `{ input, spelling, reason: 'invalid', issues }`. `input` is the option's identity, and `spelling` is its reported spelling, or its declared name in an invocation by name. `issues` holds the issues its `-v` line would have read: `[{ message: 'Use a string or a number.' }]`, or `[{ message: 'Use a string or a number.', path: [1] }]` for an item of a multiple option.

  The message holds one line for each issue, in the same order, joined by one line break. Each issue of the file's problem has `message` equal to its line without the application name, and no `path`, because the path is part of the line. So the failure above holds `issues: [{ message: 'Configuration value delivery.retries in .collector.toml: Invalid input: expected number, received string. Correct the value, or remove it.' }, { message: 'Unknown key delivery.webhok in .collector.toml. Check its spelling, or remove it.' }]`. A linked option's issue is its own sentence, as above, with a `path` for an item of a multiple option. Core's default text opens each line with the application name. The [failure form](../core/failures.md#the-failure-form)'s `message` holds the same lines as plain text: `{"code":"invalid-input","exitCode":2,"message":"Configuration value delivery.retries in .collector.toml: Invalid input: expected number, received string. Correct the value, or remove it.\nUnknown key delivery.webhok in .collector.toml. Check its spelling, or remove it.","hints":[]}`.
- **The lines.** Each line names the key and the file, as its labels show the file, and then says what to do:
  - **A rejected value.** `Configuration value <path> in <file>: <message>. Correct the value, or remove it.` `<message>` is the first issue's message for the removed value, the schema's own, and `<path>` is that issue's own path, built as a `-v` line builds a path, so a key inside an array item reads `sessions.sources[1].root`, with each array item at its position in the file as read, as **Named at `-v`** states. The issue's path is longer than the removed value's path where the drop rule cuts it, at an array item or at the nearest value the file holds, so a missing `delivery.webhook` reads `delivery.webhook`, although the drop rule removes `delivery`. A `-v` line for a removal that `strict` does not cover names the removed value, as **Dropping values** states. Both name an array item by its position in the file as read, whichever round removes it. An issue for an item past the end of an array that lost an item in an earlier round, as a tuple reports once an earlier item is removed, names the array, because no item of the file as read stands there. A period follows `<message>` unless it already ends in `.`, `!`, or `?`, as the `empty-file` fault's sentence adds one.
  - **A rejected file.** An issue with no path, which removes every key, reads `Configuration file <file>: <message>. Correct the file, or remove it.`, with the same period rule.
  - **An unknown key.** `Unknown key <path> in <file>. Check its spelling, or remove it.`, with `<path>` built as the key's `-v` line builds it.
  - **A broken file.** `Configuration file <file> <clause>. <fix>`, under **A broken file**.
  - **A linked option's value.** `Option "<spelling>" (from <label>): <message>`, core's own diagnostic for a filled value, under [Input sources](../core/input-sources.md#filled-values). `<label>` is the answer's label, such as `delivery.webhook in .collector.toml`, and an issue's position follows the parenthesis, as in `Option "--field" (from fields in .collector.toml) at 1: Use a string or a number.` The source writes the line for a value the option cannot take, and `<message>` is then its `-v` line's sentence, such as `Use true or false.` Core writes it for a value that the option's validator rejects, and `<message>` is the validator's.

  Each piece of raw text, the path, the file, and the schema's message, is escaped as a `-v` line escapes it, under **Text**, so a key that holds a newline stays on one line.
- **Why the schema's message prints.** Rule 6 of the [failure message voice](../core/failures.md#failure-message-voice) bars text that Loom did not write: a thrown cause, an engine reason, or a stack. The schema belongs to the application. Its message is the issue that the author's validator returns for the operator, as an option validator's message is, which core prints in every failure for a rejected value, and which the plugin already prints at `-v`. It is neither a cause nor an engine reason, so it may print. Under rule 4 the plugin repeats no value the file holds. Whether the schema's message repeats one is the author's choice, as it is for an option's validator. valibot's messages do, as in `Invalid type: Expected number but received "three"`. A key path is the file's structure, as a spelling is, and core's failures already print one in a label.
- **A listed path the schema cannot hold.** When the graph's `configuration.schema` holds a shape, under **Publishing the schema**, the plugin's `onGraphBuilt` hook judges each listed path, in list order, after it judges the links. It judges the path as it judges a link's path under **A link the schema cannot hold**. A path whose keys the shape does not hold throws a `DeclarationError`: `@loomcli/plugins/config/strict-schema-path`, `Plugin "@loomcli/plugins/config" strict lists delivry, which the configuration schema does not hold.`, corrected by `List a path the schema describes, or add the key to the schema.` A listed path that passes through an array is a declaration fault, unless a member of the same shape that is not an array holds the next key or leaves it unchecked. Where the walk meets a shape that describes an array before the last segment, it goes on through the members that are not arrays when one of them holds the next segment or leaves it unchecked, so `x.a` builds when `x` is an array or an object that holds `a`. Otherwise the path throws the same code, because an array item's index equals no segment, so the path would cover nothing: `Plugin "@loomcli/plugins/config" strict lists sessions.sources.harness, which passes through the array at sessions.sources.`, corrected by `List the array's own path, which covers every item.` Each sentence escapes the paths it names. The hook judges no type, because a listed path may cover any value. A key that the link check leaves unchecked passes, such as a key in an open object. A schema with no JSON Schema gets no check.
- **A broken file.** Under any `strict`, `true` or a list, a file the variable names or the lookup finds that cannot be used fails the run in place of the warning that **Broken files** states: one the plugin cannot read, a directory in its place included, one that does not parse in its format, and one whose top level is not an object or a mapping. Such a file discards every value it holds, so every value `strict` covers, whichever paths a list names. The failure is the one above, and it holds the file's problem alone, with one issue: `Configuration file <file> <clause>. <fix>`, where `<clause>` and `<fix>` are the warning's own, and `<file>` is the file as its labels show it, escaped as the other lines are. So `Skipped .collector.toml: the file is not valid TOML at line 3, column 5, so this run reads no configuration. Correct its syntax, or remove it.` becomes `collector: Configuration file .collector.toml is not valid TOML at line 3, column 5. Correct its syntax, or remove it.` A later candidate that a directory skips unread, under **Candidates**, keeps its warning, written before the failure.
- **Nothing else changes.** `strict` judges the values of the file the run reads, and whether a file it finds can be used. A missing file keeps its rule, under **Missing and broken files**, silent or noticed, except a variable's file whose extension names a format the application does not read, which is unread whether it exists or not and fails as a broken file does, and the named file fails the run for being missing or broken, as it does without `strict`. A run that reads no file, a run under `--no-config`, and a takeover such as `--help` fail for nothing. The `empty-file` fault is unchanged. The top-level `$schema` key is removed before the schema validates the file, so it never fails a run. A read that fails builds no `provided.config`. The published JSON Schema, the manifest, help, and every line and exit code of a value that `strict` does not cover are unchanged.

## Linking an option

- **The binding.** `configInput({ path })` is an option-target descriptor with the identity `@loomcli/plugins/config/input`, exported from the declarations module `@loomcli/plugins/config/extension`, which also exports its facts type `ConfigInputFacts`. A local option, a global option, and another plugin's option may carry it beside `env`, and an option that carries it is configuration-bound under [Input sources](../core/input-sources.md#configuration-sources). The order of tiers is core's: argv, then the environment, then the configuration, then the declared default.
- **The path.** `path` is dotted: it splits on `.`, and each segment is one object key. A segment is nonempty. There is no escaping and no array indexing, so a key that holds a dot is not reachable. A path that breaks the rule is rejected by the descriptor's schema, so `configInput({ path: 'a..b' })` throws at the call as any rejected extension value does, with the issue `Supply a dotted path of nonempty keys.`
- **Where it prints.** Help prints the path as the `config: <path>` fact of the option's row on both pages, under [Help variants](help.md#help-variants), and the man page prints it as the option's `Configuration:` line.
- **What a link answers.** A linked option takes the value the file holds at its path once the file has passed the schema, so a value the schema removed fills nothing, and a schema default or transform never reaches the option: the option's own default and validator decide. A path that meets a missing key, or a value that is not an object before its last segment, does not lead to a value, so the request has no answer. A run with no configuration file answers nothing.
- **Values.** A string option takes a string as it is, or a finite number as `JSON.stringify` writes it, whatever the format wrote, so `5` fills `"5"` and the option's validator decides, and TOML `5_000` and YAML `0x1F` fill `"5000"` and `"31"`. A TOML integer beyond `-(2^53 - 1)` through `2^53 - 1` fills its exact decimal digits, so `12345678901234567890` fills `"12345678901234567890"`. A TOML date or time fills its text as written in the file: `1979-05-27T07:32:00-08:00`, `1979-05-27 07:32:00`, `1979-05-27`, and `07:32:00.5` each fill as written, with no precision added and no separator changed. The YAML core schema has no date type, so `2001-12-14` is already a string. A Boolean option takes a JSON or TOML `true` or `false`, or a YAML core-schema Boolean, `true`, `True`, `TRUE`, or their `false` forms, which states the option's value, not a spelling, under every polarity, as an environment value does; a YAML `yes`, `no`, `on`, or `off` is a string. A [counted option](../core/options.md#counted-options) takes any number the format wrote that is a whole number of 0 or more, so `3`, TOML `1_0` and `3.0`, and YAML `0x3` fill `3`, `10`, `3`, and `3`, and `0` is a fill. A multiple option takes a JSON or TOML array or a YAML sequence whose items each follow the string rule, and an empty one is a fill. An option that declares an [arity](../core/options.md#option-value-arity) takes an array of exactly that many items, each following the string rule, so `{ "size": [800, 600] }` fills `["800", "600"]`, and a multiple one takes an array of such arrays, `{ "point": [[1, 2], [3, 4]] }`. A string option with an [implied value](../core/options.md#implied-values) takes a value by the string rule and never its implied value.
- **A value the option cannot take.** Any other value is not answered: a JSON `null`, a YAML null, written `null`, `~`, or as a key with no value, an object, table, or mapping, a Boolean for a string option, a string for a Boolean option, a string, a Boolean, or a negative or fractional number for a counted option, a bare value for a multiple option or one with an item that breaks the string rule, and a number that is not finite, such as JSON `1e400`, which overflows to infinity, TOML `inf` and `nan`, and YAML `.inf` and `.nan`. The option falls through to its default, `provided.config` keeps the value, and the source logs one `log.debug` line in core's form for a dropped fill: `Ignored option "--min-bytes" from minBytes in .collector.toml: Use a string or a number.` A Boolean option reads `Use true or false.`, a counted option reads `Use a whole number of 0 or more.`, a multiple option given a bare value reads `Use an array of strings or numbers.`, an option with an arity of 2 reads `Use an array of 2 strings or numbers.` for any value that is not an array of exactly 2 such items, and a multiple one reads `Use an array of arrays, each of 2 strings or numbers.`, one line for the whole value, and an array item that breaks the string rule reads its position after the option, `Ignored option "--field" at 1 from fields in .collector.toml: Use a string or a number.` The option is named by core's [`reportedSpelling`](../core/failures.md#failure-classes), `--no-<name>` included, and in an [invocation by name](../core/invocation.md#invocation-by-name) by its declared name. For an option that `strict` covers, the value fails the run instead, under **The strict setting**.
- **A value the option's validator rejects.** Core drops the fill and the option falls back, with its own `-v` line, under [Input sources](../core/input-sources.md). `provided.config` keeps the value, because the schema accepted it. For an option that `strict` covers, the answer carries `strict: true`, and core fails the run instead, under **The strict setting**.
- **A link the schema cannot hold.** When the graph's `configuration.schema` holds a shape, under **Publishing the schema**, the plugin's `onGraphBuilt` hook reads it and judges each option that carries `configInput`. A path whose keys the shape does not hold throws a `DeclarationError`: `@loomcli/plugins/config/link-path`, `Global option "min-bytes" links to minBytes, which the configuration schema does not hold.`, corrected by `Link a path the schema describes, or add the key to the schema.` A path whose type in the shape the option cannot take under **Values**, in every branch of a union, throws under `@loomcli/plugins/config/link-type`: `Global option "min-bytes" links to sessions, which holds an object.`, corrected by `Link a key that holds a value the option takes: a string or a number for a string option, a Boolean for a Boolean option, a whole number for a counted option, or an array for a multiple or arity option.` The hook walks the shape by these keywords alone. An object holds a key that its `properties` lists. An object is open when it has `additionalProperties` or `patternProperties` with a value other than `false`, so `z.looseObject` and a record are open, while zod's and ArkType's plain objects, which name neither keyword, are judged. A `$ref` to the shape's own `$defs` is followed. Under `allOf` a key is held when any member holds it, and under `anyOf` or `oneOf` when any branch holds it. A type is judged from `type`, `const`, or `enum`; a shape that names none takes any value. A schema without a converter, such as valibot's, and one whose converter fails, such as zod's for `z.bigint()`, publish no JSON Schema and get no check. At each key the hook judges every shape the path stands for, each member of a union (`anyOf` or `oneOf`) or an `allOf` included. The key gets no check when any of those shapes describes an array, names no keyword but annotations (`title`, `description`, `default`, `examples`, `deprecated`, `readOnly`, `writeOnly`, `$comment`, `$id`, or `$schema`), or is open and does not list the key, because that shape can hold any value there. A shape that lists the key is walked whether it is open or not, so `z.union([z.looseObject({ fast: z.boolean().optional() }), z.object({})])` linked at `fast` from a string option throws `link-type`. The fault names the option the way the graph records it: `Global option "min-bytes"`, `Command "a b" option "min-bytes"`, or `The root Command option "min-bytes"`, because the graph does not record which plugin declared an option.

## File-relative paths

- **A linked option.** A relative path in the file resolves against the file's directory, as tsconfig, git's `include.path`, and Cargo resolve it, for an option linked to it. Every answer the source gives carries the file's absolute `directory`, so the option's validator, such as [`path()`](../libs/validators.md), reads that directory as `host.cwd`, under [Input sources](../core/input-sources.md).
- **The schema keeps paths as written.** A Standard Schema library passes no options to the validators nested inside it, so the plugin cannot give the schema a host whose `cwd` is the file's directory, and `provided.config` holds each path as the file wrote it.
- **No `~`.** The plugin expands no `~` in a value, and neither does `path()`. A value that holds `~/notes` resolves as a relative path that starts with a folder named `~`.

## Lookup

A run reads at most one configuration file, and nothing is merged across files. Under `--no-config` it reads none. Otherwise the plugin tries each step in order and stops at the first that yields a file. Steps 3 to 5 belong to the scopes the author chooses, under **Scopes**, and a step whose scope is not read is skipped.

1. **`--config <path>`.** That file is the configuration, and the plugin looks nowhere else. The path is not a pattern, so `*` and braces in it are part of the name, a relative path resolves against `host.cwd`, and its extension chooses its parser as **Formats** states. A missing or broken file fails the run, under **The named file**.
2. **The variable.** With `env` set, the plugin reads that variable from `host.env`. A nonempty value names the configuration file, read with no search: a relative value resolves against `host.cwd`, it is not a pattern, and its extension chooses its parser. A file whose extension names a format the application does not read is unread, whether it exists or not, and warns or fails as a broken file does. Any other missing file prints nothing and the run has no configuration. A broken file warns once, under **Broken files**, and the run has no configuration, or fails the run under `strict`. An empty or unset variable is skipped.
3. **The walk, the project scope.** The plugin looks for `file` in the start directory and then in each of its ancestors, and never in the home directory, which belongs to the user scope, nor above the host's ceiling. The walk ends at the first of four stops it meets. When the start directory is inside the home directory, the walk ends at the directory below home, and when it is the home directory the walk looks nowhere. When the host has a ceiling, the walk ends at it, or in the start directory for a start outside it, under **The ceiling**. With a root marker, the walk ends at the first directory that holds an entry of a marker's name, after looking for `file` there, under **The root marker**. Otherwise it ends at the filesystem root. The start directory is the directory option's value when the author declares one and the operator gives it, and `host.cwd` otherwise. The home directory is [`host.home`](../core/host.md#the-home-and-temporary-folders) on every platform, and a home that is empty or a relative path gives no home directory, so the walk ends at the root. Paths compare lexically, as `node:path` resolves them, and a file that is a symbolic link is read through it.
4. **The home file, the user scope.** `file` in the home directory.
5. **The XDG user file, the user scope.** `config.<ext>` in `$XDG_CONFIG_HOME/<app>`, or in `<home>/.config/<app>` when `XDG_CONFIG_HOME` is unset, empty, or a relative path, where `<app>` is `graph.name`. Each of the pattern's candidates names one extension, in candidate order: its own when it is `json`, `jsonc`, `toml`, `yaml`, or `yml`, and `json` otherwise, because such a name reads as JSON. An extension named twice counts once, so `.collector.{toml,json}` looks for `config.toml` and then `config.json`, and `.collectorrc` for `config.json`. With neither `XDG_CONFIG_HOME` nor a home directory there is no user file.

- **Scopes.** The project scope is the walk, for an application run from a project, such as a build tool, whose file describes that project. The user scope is the home file and then the XDG user file, for an application run from the operator's shell, whose file describes the operator's setup. `scopes` names the ones the lookup reads, both by default, and the project scope is always read first. `--config` and the variable name one file each and belong to no scope, so they apply under every choice. A system scope, a machine-wide file, is not offered.
- **The root marker.** `root` names one or more entries that mark the directory where a project ends, such as `package.json` or `.git`. In each directory it walks, the project walk looks for `file` first, then checks for an entry of each marker's name, a file, a directory, or a symbolic link, and ends after a directory that holds one. So with `root: 'package.json'`, a run in a package's `src` directory looks in `src`, then in the package directory, and stops, and a file in a monorepo root above it is never read. The walk still ends below home, at the ceiling, and at the filesystem root when it meets no marker. With no marker, the walk runs to the directory below home, to the ceiling, or to the filesystem root, whichever it meets first, as step 3 states.
- **The ceiling.** A run's host may hold a ceiling, [`host.ceiling`](../core/host.md#the-process-handle), a directory the walk never looks above. The real process's handle names none, so a real run's walk ends as step 3 states without it, and a [mock](../libs/testing.md#mockprocess) names its own working directory unless the test names another. The walk looks in the ceiling directory itself and never in an ancestor of it:
  - From a start directory that is the ceiling or inside it, the walk ends after it looks in the ceiling. With the ceiling `/work/sandbox/app`, a walk from `/work/sandbox/app/src` looks in `src`, then in `app`, and ends, and a walk from `/work/sandbox/app` looks in `app` alone.
  - A start directory that is outside the ceiling, being neither the ceiling, inside it, nor an ancestor of it, is looked in alone: the walk reads no ancestor of it. The directory option's value can name such a start. With the same ceiling, a walk from `/work/sandbox/other/deep` looks in `deep` and ends, so neither `other` nor `/work/sandbox` is looked in.
  - A start directory that is itself an ancestor of the ceiling, such as `/work/sandbox`, looks nowhere.
  - The filesystem root is an ancestor of every ceiling other than the root, so a walk under such a ceiling never looks in the root, and a ceiling of `/` ends the walk where it ends without one.

  The ceiling joins the other stops, and the walk ends at whichever it meets first: below home, the ceiling, a directory that holds a root marker, and the filesystem root. So a walk from inside a ceiling that is inside home ends at the ceiling, for a start directory inside home a ceiling at home or above it ends nothing the home stop has not ended first, a root marker below the ceiling ends the walk at the marker's directory, and a marker in or above the ceiling changes nothing. The ceiling compares lexically, as `node:path` resolves it, like every path of the walk, so a relative ceiling resolves against the process's working directory. It bounds the walk alone: the home file and the XDG user file are read wherever `host.home` and `host.env` place them, and `--config` and the variable name a file wherever it is. [ADR-0153](../decisions/0153-a-process-handle-may-name-a-ceiling-the-configuration-walk-never-looks-above-and-a-mock-names-its-working-directory.md) records the ceiling.
- **Candidates.** In each directory a step looks in, the first of the pattern's candidates that something is at is the file the plugin finds there. Every later candidate also present in that directory is skipped and never read, and the plugin writes one warning through `out.warn`, ahead of any warning about the file it found: `Skipped <file>: <chosen> matches the same pattern first. Keep one of the files, and remove the others.`, where `<file>` is every skipped candidate in candidate order, joined by `, `, and `<chosen>` is the file found, each shown as a label shows a file. A later candidate never answers in place of a broken first one.
- **`--no-config`.** A global Boolean option, marked `control: true` and described `Read no configuration file.`, that binds no variable and no configuration key. With it, the run reads no file: not the variable's, the walk's, the home file, or the user file, and it writes no notice. No linked option is answered, and a Command that opts in reads the schema's output for an empty file. CI, tests, and agents use it for a run that an operator's dotfile cannot change. With `--config` beside it, in either order, the run fails once some value is needed: the source, or the provider when it reads first, throws an `InputError` whose one problem is the one core gives an exclusive option group, `{ reason: 'exclusive', inputs: [{ kind: 'option', name: 'config', global: true }, { kind: 'option', name: 'no-config', global: true }], spellings: ['--config', '--no-config'], supplied: ['--config', '--no-config'] }`, and stderr reads `<application>: Options "--config" and "--no-config" cannot be used together. Supply only one of them.` The code is 2. In an [invocation by name](../core/invocation.md#invocation-by-name) the spellings are `config` and `no-config`.
- **No system level.** The plugin reads no machine-wide file, such as one under `/etc`.
- **The directory option.** With `directory: { name }`, the plugin declares a global string option, `--<name>`, not marked `control`, whose value replaces `host.cwd` as the walk's start directory. It does not change `host.cwd`. The action reads it as it reads any plugin option, so an application that takes a project directory uses one option for its own work and for the lookup. A relative value resolves against `host.cwd`. The plugin judges nothing about the directory: one that does not exist starts the walk there, and the walk goes on through its ancestors as step 3 states, so a start outside the host's ceiling is looked in alone. `--config` and the variable still come first. The option binds no variable, and its description defaults to `Look for the configuration file from this directory.`

## Reading

- **When.** The lookup runs and the file is read the first time a run needs it: when core calls the source for an unfilled configuration-bound option, or when core builds the provider for a Command that opts in.
- **Text.** The plugin reads the file it finds as UTF-8 with a leading byte order mark ignored, and parses it by its extension as JSON with comments, or through the reader passed for its format, under [Readers](#readers): the TOML reader parses with `smol-toml`, so a TOML file reads as `smol-toml` reads it, a time written without seconds included, and the YAML reader with `yaml`.
- **JSON with comments.** A file read as JSON may hold `//` and `/* */` comments wherever JSON allows whitespace, and one comma after the last item of an object or an array, as tsconfig reads its files, whatever the file's extension. Nothing else of JSON5 is read: keys are quoted, strings use double quotes, and numbers are JSON's. The plugin scans the text itself: a text that passes has each comment and trailing comma blanked to spaces, and `JSON.parse` builds its value, so a strict JSON file reads as `JSON.parse` reads it, a `__proto__` key as an own key included. A comment inside a string is part of the string. Each reader loads its parser package with a dynamic import only after the plugin reads the text of a file of that kind, so a run that reads a JSON file loads neither, even in an application that passes both readers.
- **Documents.** An empty JSON file is not valid JSON, an empty TOML file is an empty table, and an empty YAML file, or one that holds only comments, holds no mapping. A YAML file holds one document with unique keys and only the core schema's tags: a second document, a repeated key, and a tag such as `!!binary`, `!!timestamp`, or a local `!tag` make it not valid YAML. The plugin converts the document with the parser's own `toJS()`, so a key reads as `toJS()` writes it. An alias reads as the value its anchor names, with no limit on how many aliases a file holds, and an alias that names no preceding anchor makes the file not valid YAML. A TOML document is always a table at its top level.
- **Formats.** A file's extension chooses its parser: `.toml` reads as TOML through the TOML reader, with `smol-toml` (TOML 1.0, with the TOML 1.1 additions it accepts), and `.yaml` and `.yml` as YAML 1.2 under its core schema through the YAML reader, with `yaml`. An application that does not pass a format's reader does not read that format's files, under [Readers](#readers). Every other name reads as JSON with comments: `.json`, `.jsonc`, a name with no extension, such as `.textstatrc`, and a name with any other extension, such as `.textstat.conf` or `config.cfg`. The rule is the same for every step of the lookup. The file name is the path's last segment, and its extension is the text after its last `.`, unless that `.` is the name's first character. Extensions compare as written, so `.TOML` reads as JSON.
- **File patterns.** `file` is a file pattern. Glob syntax, the characters `*`, `?`, `[`, `]`, `{`, and `}`, may appear only as the whole extension of its last segment, in one of two forms: `*`, which accepts any format the application reads, or a brace list, `{toml,yaml}`, which accepts the formats it lists and lists only `json`, `jsonc`, `toml`, `yaml`, and `yml`. A `file` with no glob syntax is literal, and its extension locks its format, so `.textstat.conf` reads only as JSON. A pattern's candidates are, in order, the brace list's extensions as listed, an extension listed twice counting at its first position, or for `*` the extensions of the readers `formats` passes, `toml`, then `yaml` and `yml`, whatever the order of `formats`, then `json` and `jsonc`; a literal name is its own one candidate. With no readers, `*` names `json` and `jsonc` alone. After the path check, `configuration()` checks the pattern, then the formats its candidates name, and throws a `DeclarationError` for a `file` that breaks a rule, with the finding marking `file`:
  - **Glob placement.** Glob syntax appears only as the whole extension of `*` or a brace list, never in a directory segment, in the name before its extension, or in an extension such as `t*`: [`@loomcli/plugins/config/file-pattern`](../core/diagnostics.md#loomclipluginsconfigfile-pattern).
  - **Listed extensions.** A brace list lists only `json`, `jsonc`, `toml`, `yaml`, and `yml`, so `.textstat.{toml,ini}` and an empty item fail: [`@loomcli/plugins/config/file-pattern`](../core/diagnostics.md#loomclipluginsconfigfile-pattern). A literal name never meets this rule.
  - **Readers.** A candidate whose extension is `toml`, `yaml`, or `yml`, listed in braces or as a literal name, needs its format's reader in `formats`, so `.textstat.{toml,json}` with no readers fails: [`@loomcli/plugins/config/file-format`](../core/diagnostics.md#loomclipluginsconfigfile-format), `Plugin "@loomcli/plugins/config" file names toml files, and formats holds no reader for them.`, corrected by `Pass toml, from @loomcli/plugins/config/toml, in formats.` The sentence names the first such candidate's extension, and the correction the reader that reads it, `yaml` for `yml`.

## Readers

The plugin reads JSON itself. TOML and YAML read only through a reader the application passes in `formats`, each exported from its own subpath, so an application imports, and its bundle holds, only the parsers of the formats it reads. [ADR-0196](../decisions/0196-an-application-passes-the-toml-and-yaml-readers-it-reads-and-the-configuration-plugin-reads-json-alone-without-them.md) records the decision.

```ts
// src/configuration.ts, for an application that reads TOML and YAML beside JSON.
import { configuration } from '@loomcli/plugins/config';
import { toml } from '@loomcli/plugins/config/toml';
import { yaml } from '@loomcli/plugins/config/yaml';
import { z } from 'zod';

export const { plugin: configPlugin, values: config } = configuration({
  file: '.collector.*',
  formats: [toml, yaml],
  schema: z.object({ minBytes: z.number().optional() }),
});
```

- **The readers.** `toml`, from `@loomcli/plugins/config/toml`, reads `.toml` files, and `yaml`, from `@loomcli/plugins/config/yaml`, reads `.yaml` and `.yml` files. A reader is a sealed value of type `ConfigurationReader`, exported with `ReaderFormat` from `@loomcli/plugins/config` and from each reader's subpath. It shows only its format and carries a brand that only the pack's own values hold, so an object an author writes with a `format` does not type-check in `formats`, and the plugin finds a reader's parser by the value itself.
- **JSON alone by default.** With no `formats`, the plugin reads `.json`, `.jsonc`, and every name no reader claims as JSON, `*` in `file` names `json` and `jsonc` alone, and a `file` that names a TOML or YAML file throws at the call, under **File patterns**.
- **The bundle.** The plugin's own modules import neither reader, so a bundler that follows imports, as `loom build` does, leaves out `smol-toml`, `yaml`, and their licenses for an application that passes neither reader. A reader still loads its parser only when a run reads a file of its format.
- **What the operator meets.** `--config` naming a `.toml`, `.yaml`, or `.yml` file the application does not read fails, and the variable's file of such a format warns, under **Missing and broken files**.

## Missing and broken files

- **Labels.** A file the walk finds in `host.cwd` shows as `file` names it, with a pattern's extension replaced by the candidate's, and so does the home file when `host.cwd` is the home directory and the start directory is inside it. A file found anywhere else in the walk, any other home file, and the XDG user file show as their full paths. The `--config` file and the variable's file show as the operator wrote them. An answer's label is `<path> in <file>`: `minBytes in .collector.toml`.
- **Missing files.** A step whose file does not exist, including one under a directory that does not exist or under a path component that is a file, prints nothing, and the lookup goes on to the next step, except after the variable, whose missing file ends the lookup with no configuration. A variable's file whose extension names a format the application does not read is unread rather than missing, under **Broken files**. With `notice: true`, a run whose lookup finds no file writes one `out.info` line: `Found no configuration file. Create <file> to configure <app>.`, where `<file>` is the first candidate in the first directory the lookup looks in, shown as a label shows it: `file`'s in the start directory, or, when the walk looks nowhere or `scopes` does not list `'project'`, `file`'s in the home directory, or with no home directory the first user file under **The XDG user file**. A walk that starts at an ancestor of the ceiling also looks nowhere. A lookup that looks nowhere, such as one with only the project scope that starts in the home directory, writes no line, and `<app>` is `graph.name`. The notice is off by default, and a variable that names a missing file and a run under `--no-config` write none.
- **Broken files.** A file the variable names or the lookup finds that the plugin cannot read, a directory in its place included, one that does not parse in its format, and one whose top level is not an object or a mapping are not used, and the plugin writes one warning through `out.warn`, and the run has no configuration: no later step answers in its place. Under `strict` such a file fails the run instead, under **The strict setting**. The warnings read `Skipped <file>: the file could not be read, so this run reads no configuration. Make it readable, or remove it.`, `Skipped <file>: the file is not valid JSON at line <line>, column <column>, so this run reads no configuration. Correct its syntax, or remove it.`, `Skipped <file>: the file does not hold a JSON object, so this run reads no configuration. Write its settings as one JSON object, or remove it.`, `Skipped <file>: the file is not valid TOML at line <line>, column <column>, so this run reads no configuration. Correct its syntax, or remove it.`, `Skipped <file>: the file is not valid YAML at line <line>, column <column>, so this run reads no configuration. Correct its syntax, or remove it.`, and `Skipped <file>: the file does not hold a YAML mapping, so this run reads no configuration. Write its settings as one YAML mapping, or remove it.` A file the variable names whose extension names a format the application does not read is not used either, whether it exists or not, because the plugin judges its name before it reads: unread, `Skipped <file>: the file is TOML, which this application does not read, so this run reads no configuration. Supply a JSON file.` A file the lookup finds always has its reader, because `configuration()` judges the pattern's candidates.
- **Where a file breaks.** A file that does not parse names the place where it breaks, under [ADR-0120](../decisions/0120-a-json-configuration-file-holds-comments-and-a-file-that-does-not-parse-names-its-line-and-column.md). Lines and columns count from 1. A line ends at LF, at CRLF, or at a lone CR, and a column counts characters, one per code point, so an emoji and a tab each count once and a leading byte order mark is not a column. JSON names the first character its scan cannot accept, or the end of the text when the text ends early, so an empty file breaks at line 1, column 1. TOML names the place `smol-toml` names. YAML names the place of `yaml`'s first error, or else of a tag outside the core schema, or else of an alias that names no preceding anchor. A YAML conversion failure the plugin does not foresee names no place, and the sentence reads without ` at line <line>, column <column>`. A file whose top level is not an object or a mapping names no place either.
- **The named file.** A `--config` file with any of those faults fails the run. The source, or the provider when it reads first, throws an `InputError` whose one problem is `{ input: { kind: 'option', name: 'config', global: true }, spelling: '--config', reason: 'invalid', issues: [{ message: 'File "<path>" does not exist. Supply the path of an existing file.' }] }`, and stderr reads `<application>: Option "--config": File "<path>" does not exist. Supply the path of an existing file.`, opened by the application name, with `could not be read. Supply a file this process can read.`, `is not valid JSON at line <line>, column <column>. Correct its syntax, or supply another file.`, `does not hold a JSON object. Write its settings as one JSON object.`, `is not valid TOML at line <line>, column <column>. Correct its syntax, or supply another file.`, `is not valid YAML at line <line>, column <column>. Correct its syntax, or supply another file.`, or `does not hold a YAML mapping. Write its settings as one YAML mapping.` in place of the last clause. A `--config` file whose extension is `toml`, `yaml`, or `yml` in an application that does not pass that format's reader fails before the plugin reads it, whether it exists or not, with `is TOML, which this application does not read. Supply a JSON file.` in place of the last clause, where the sentence names the file's format and the step every format the application reads, as in `Supply a JSON or YAML file.` A `--config` file of any other name reads as JSON. The problem spells the option `--config` whichever spelling the operator typed, and `config` in an [invocation by name](../core/invocation.md#invocation-by-name). The code is 2, and `--help` reports nothing, as [Input sources](../core/input-sources.md) holds every source `InputError`. A provider's `InputError` takes the ordinary failure path from the dispatch boundary with the same code.

## At -v and in the log

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Read configuration from <file>.` | Once the file the lookup chose, the `--config` file, the variable's, or a discovered one, is read and parses, before any `Ignored` line about it. |
| `-v` | `Found no configuration file.` | The lookup ends with no file found: no step found one, a variable that names a missing file included. Not under `--no-config`, not when the `notice: true` notice prints, because it opens with the same sentence, and not after a broken file, whose warning already says the run reads no configuration. With `notice: true`, a run whose notice does not print, because the variable names a missing file or the lookup looks nowhere, writes this line. |
| `-v` | `Ignored <path> in <file>: <message>` | A dropped value or an unknown key, under **Dropping values** and **Naming unknown keys**. |
| `-vv` | `Looked for <file>: not found.` | Once for each candidate path the lookup checks and finds nothing at, in the lookup's order, the variable's missing file included. In the directory where the lookup finds a file, only the candidates before that file write a line: a later absent candidate writes none, and a later present one keeps its warning and writes none. |

`<file>` is the file as the labels under **Missing and broken files** show it, escaped with `style.escape` and kept on one line, as a warning shows it. The source and the provider share one read per run, so each line is written once, through the `out` of whichever reads first, and a run that needs no configuration value writes none. Under `--no-config` the run looks for no file and writes no line.

```text
$ collector sources -vv
  ┆ Looked for .collector.toml: not found.
  ┆ Looked for /home/me/work/.collector.toml: not found.
› Read configuration from /home/me/.collector.toml.
```

- **Log events.** The plugin reads and never writes, so it records no [change event](../core/logging.md#change-events).
- **Log lines.** Each `-v` line is one `log.debug` call and each `-vv` line one `log.trace` call, whose message is a constant [message template](../core/logging.md#message-templates) with the values the line shows in the event's fields, so the screen reads the sentence the table shows and a record keeps the template. Core shows each through its [log-line view](../core/logging.md#at--v) under the run's [verbosity](../core/verbosity.md): `-v -q` shows none, the lines go to stderr whether or not it is a terminal, an [`app.invoke`](../core/invocation.md#invocation-by-name) shows them in its `messages` when its values ask for them, and under an action's `invoke` or an [MCP](mcp.md) tool call they follow the outermost run's verbosity. Every value a line shows passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). Each line is a log event, so an installed [logging plugin](logging.md) records it at its level, and each change event the plugin records shows at `-v` too, as every `info` event does. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the lines and the events, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) moves the lines onto `log`.

## Text and portability

- **Text.** Every sentence the plugin writes is fixed and carries no parser message, the YAML parser's warnings included, and a position is two numbers the plugin counts itself, so the bytes are the same under Node and Bun and no file content reaches the terminal at the default verbosity, except the key paths a failure under **The strict setting** names and the schema's message, which may repeat a value as the author's schema chooses. A `-v` line for a removed value carries the schema's own message, which is the author's, and so does a strict failure's line for a rejected value. A `-v` line for an unknown key, and a strict failure's line for one, carry the plugin's fixed sentence. Each character [`escapeControlCharacters`](../core/styles.md#strings-and-composition) escapes in a file path, a bound key path, the path a `-v` line names, or a schema message prints as that escape wherever it leaves the plugin: in an answer's label, which core prints as it is, in a warning, the candidates a several-candidates warning names included, in a `-v` line, and in a failure, a strict failure's lines included. A position is read with [`issuePath`](../core/failures.md#failure-classes) and escaped the same way. A warning escapes each path with `style.escape` before the call.
- **Portability.** The plugin reads files through `node:fs/promises` and joins paths through `node:path`, which Node and Bun both provide. It is the one pack module that imports either. `yaml` (ISC) and `smol-toml` (BSD-3-Clause) are runtime dependencies of `@loomcli/plugins` beside `valibot` and `@loomcli/validators`, each installed as its own package with its own license, so the pack's `license` field and NOTICE do not change. Only the reader modules import them, so a bundle holds a parser, and needs its notice, only when the application imports that format's reader.
