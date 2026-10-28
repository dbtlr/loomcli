---
description: "The configuration plugin: one configuration file per run described by one schema, read as provided.config and linked to options, and how the plugin finds it."
---

# Configuration plugin

This page documents the configuration plugin, which reads the one configuration file a run uses, validates it with the author's schema, hands the result to application code as a provided value, and fills the options linked to its keys. An author installs it so an operator can configure the application in a file.

```ts
// @loomcli/plugins/config
import type { Plugin, PluginOptionValues, Provider, StandardSchemaV1, StringOption } from '@loomcli/core';

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

interface ConfigurationSettings<Schema extends StandardSchemaV1, Directory extends string> {
  /** One Standard Schema for the whole file. Every key is optional outside an array item. */
  readonly schema: Schema & EmptyFileGuard<Schema>;
  /** The configuration file's name or relative path, a file pattern. Defaults to `.<app>.json`. */
  readonly file?: string;
  /** The short spelling of `--config`, none by default. */
  readonly short?: Short;
  /** A variable that names the configuration file, none by default. */
  readonly env?: string;
  /** A global option whose value is where the lookup's walk starts, none by default. */
  /** A directory option named config would claim --config's spelling, so the type rejects it. */
  readonly directory?: DirectorySetting<Directory> & ('config' extends Directory ? { readonly name: never } : unknown);
  /** Write one line when the lookup finds no file. Off by default. */
  readonly notice?: boolean;
}

type ConfigOptions<Directory extends string = never> = {
  config: { control: true; description: string; type: 'string' };
} & { [Name in Directory]: { description: string; type: 'string' } };

interface Configuration<Schema extends StandardSchemaV1, Directory extends string> {
  /** The plugin the Application installs. */
  readonly plugin: Plugin<ConfigOptions<Directory>>;
  /** The validated configuration, read as provided.config. */
  readonly values: Provider<'config', StandardSchemaV1.InferOutput<Schema>, PluginOptionValues<ConfigOptions<Directory>>>;
}

export declare function configuration<const Schema extends StandardSchemaV1, const Directory extends string = never>(
  settings: ConfigurationSettings<Schema, Directory>,
): Configuration<Schema, Directory>;

// src/config/extension.ts, the declarations module of the @loomcli/plugins/config subpath.
// configPath is the dotted-path schema the rules below state.
export const configInput = extension(`${packageName}/config/input`, {
  schema: object({ path: configPath }),
  target: 'option',
});
```

```ts
// src/configuration.ts
import { configuration } from '@loomcli/plugins/config';
import { z } from 'zod';

const collectorConfig = z.object({
  minBytes: z.number().int().nonnegative().optional(),
  sessions: z
    .object({
      sources: z.array(z.object({ harness: z.string(), dir: z.string().optional(), name: z.string().optional() })).optional(),
    })
    .optional(),
});

export const { plugin: configPlugin, values: config } = configuration({
  file: '.collector.{toml,json}',
  short: 'c',
  env: 'COLLECTOR_CONFIG',
  directory: { name: 'project', short: 'p' },
  schema: collectorConfig,
});
```

```ts
// src/main.ts
import { Application, Command } from '@loomcli/core';
import { configInput } from '@loomcli/plugins/config/extension';

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
    validate: byteThreshold,
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

`configuration()` builds the configuration plugin and the provider that reads it from one settings object. The plugin answers the configuration tier of [Input sources](../core/input-sources.md) for the options linked to the file, and the provider hands application code the whole validated file as `provided.config`. Both read one file per run, found by the lookup below. [ADR-0118](../decisions/0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) records the schema, the provider, and the drop rule, [ADR-0119](../decisions/0119-the-configuration-lookup-walks-to-home-reads-an-author-named-variable-and-the-xdg-user-file-and-never-falls-back-after-a-broken-file.md) the lookup, and [ADR-0054](../decisions/0054-the-configuration-plugin-reads-one-file-per-run-found-by-the-authors-file-pattern.md) the formats and the file pattern.

## The plugin and its values

- **One call, two values.** `configuration(settings)` returns `{ plugin, values }`. The file pattern, the schema, and every other setting are written once, because a plugin's value is opaque and frozen and no plugin installs a provider, under [Providers](../core/providers.md). The Application installs `plugin`, and a Command that reads the configuration opts in to `values`.
- **The plugin.** Its identity is `@loomcli/plugins/config`. It declares the global option `--config`, marked `control: true`, the directory option when `directory` is set, the configuration source with the binding `configInput`, and an [`onGraphBuilt`](../core/lifecycle-hooks.md#judging-the-built-graph) hook that judges links, and no middleware. Its source and its provider's opener load through `load` only when core calls them.
- **The provider.** `values` is an ephemeral provider named `config`. A Command opts in with `uses: [config]`, and its action reads `provided.config`, typed as the schema's output. The provider reads `--config` and the directory option as global options, so a Command that opts in fails to compile where it meets an Application that does not install `plugin`, under [Opting in](../core/providers.md#opting-in). Its value is the schema's output for the file once the file passes, under **Dropping values**, and a run with no configuration file provides the schema's output for an empty file. The action cannot tell which file, or whether any file, supplied a value.
- **One read per run.** The source and the provider share one lookup, one read, and one validated result per run, so each warning and each `-v` line is written once, whichever reads first. The plugin keys the shared result by the run's `host`, the one object core hands both the source and the provider of a run. A run reads no file when no option needs a configuration value and the routed Command does not opt in, the one `--config` names included, and a takeover such as `--help` builds no provider. A nested `invoke` is a run of its own and reads again.

## Settings

- **`schema`.** Required: one Standard Schema for the file's top-level object, under **The schema**.
- **`file`.** The configuration file the lookup looks for. With none, the plugin looks for `.<app>.json`, where `<app>` is `graph.name`, which it reads when it runs, because `configuration()` cannot know the application name. `file` is a file name or a relative path, such as `.mimir.toml` or `.norn/config.toml`: a nonempty string that does not start with `/`, `\`, or a drive letter and a colon, and whose segments, split on `/` and `\`, are each nonempty and neither `.` nor `..`. Any other value throws a `DeclarationError` from `configuration()`: [`@loomcli/plugins/config/file-path`](../core/diagnostics.md#loomclipluginsconfigfile-path). The finding rebuilds the `configuration()` call and marks `file`.
- **`short`.** Gives `--config` a short spelling under [Plugin settings](../core/plugin-contract.md#plugin-settings), so `short: 'c'` lets an operator type `-c`. With none, `--config` has no short spelling.
- **`env`.** Names a variable whose value names the configuration file, under **Lookup**. The plugin reads it from `host.env` itself: it is not an environment binding on `--config`, so `inspect()` publishes no `env` for it. The name follows core's variable name rule, `[A-Za-z_][A-Za-z0-9_]*`, and any other value throws a `DeclarationError` from `configuration()`: `@loomcli/plugins/config/variable-name`, `Plugin "@loomcli/plugins/config" env is not a variable name.`, corrected by `Name a variable such as COLLECTOR_CONFIG: a letter or an underscore, then letters, digits, or underscores.`
- **`directory`.** `{ name, short, description }` makes the plugin declare a global string option, `--<name>`, under **The directory option**. Core judges its name and short spelling as it judges every plugin option's, and the type rejects a `name` of `config`, which would claim `--config`'s spelling.
- **`notice`.** With `true`, a run whose lookup finds no file writes one line, under **Missing files**.
- **Faults at the call.** `configuration()` judges its settings when it is called: the `file` rules above and below, then the `env` rule. The types reject a `short` that is not one ASCII letter.

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
- **Unknown keys.** A key the schema does not describe is never reported, at any verbosity. Whether it reaches `provided.config` is the schema library's choice for a loose object.
- **Strict objects.** zod reports an unknown key in a strict object as an issue on the object itself, so the drop rule removes the whole object. The types cannot tell a strict schema from a loose one, so `@loomcli/eslint-plugin`'s [`strict-configuration-schema`](../libs/eslint-plugin.md#strict-configuration-schema) rule advises against a zod strict object. valibot and ArkType name the unknown key, so the drop rule removes that key alone. An author who turns the rule off gets what the schema reports, under the ordinary drop rule.

## Dropping values

A value in the file never fails a run. The plugin removes what the schema rejects and keeps the rest.

- **Drop and validate again.** The plugin calls the schema's `~standard.validate` with the parsed file. When the result holds issues, it removes the value at each issue's path and validates again, until the file passes. Each round removes at least one value, so the loop ends.
- **What a path removes.** A path segment is a key, or `{ key }` as Standard Schema allows. The plugin reads every issue's path against the file as it stood when the round began. A path that passes through an array item is cut at the outermost item it enters, and the whole item is removed, so an item with a missing required key or a wrong value at any depth below it is gone and the array keeps its other items. Any other path that ends at a value the file holds removes that value. A path that ends at a value the file does not hold, such as a missing key, removes the nearest enclosing value the file holds. A path with no segments removes every key, and the file then validates as an empty file. A target inside a value the same round already removes is skipped, and the plugin removes array items from the highest index down, so a removal never moves another target.
- **Records.** At run time the plugin cannot tell a record from an object, so a wrong value inside a record's value removes that value alone. When the record's value then lacks a key it requires, the next round removes the whole entry and writes a second `-v` line for it.
- **Where libraries put a path.** zod, valibot, and ArkType name the same path for a wrong value, a missing key in an array item, an array item, and a refinement on a nested object. A refinement on the top-level object has no path in all three, so it removes every key. A strict object differs: valibot and ArkType name the unknown key itself, while zod names the object that holds it, so one unknown key empties a zod strict object, the whole file at the top level. The [`strict-configuration-schema`](../libs/eslint-plugin.md#strict-configuration-schema) rule advises against strict objects for this reason.
- **Fallbacks.** A key whose value is removed falls back to its schema default, or to absence, in `provided.config`. A linked option whose value is removed has no answer from the source and falls through to its default.
- **Named at `-v`.** Each removed value writes one `out.debug` line, which shows at `-v` alone: `Ignored updates.interval in .collector.toml: <message>`, naming the removed key's path, with an array item as its index in brackets, `sessions.sources[2]`, the file as its labels show it, and the first issue's message for that path. A whole file removed reads `Ignored every key in .collector.toml: <message>`. A run with no file validates an empty file and writes no line. The message is the schema's own, so the line quotes what the author's schema reports, and the plugin escapes control characters in it as it escapes paths.

## Linking an option

- **The binding.** `configInput({ path })` is an option-target descriptor with the identity `@loomcli/plugins/config/input`, exported from the declarations module `@loomcli/plugins/config/extension`. A local option, a global option, and another plugin's option may carry it beside `env`, and an option that carries it is configuration-bound under [Input sources](../core/input-sources.md). The order of tiers is core's: argv, then the environment, then the configuration, then the declared default.
- **The path.** `path` is dotted: it splits on `.`, and each segment is one object key. A segment is nonempty. There is no escaping and no array indexing, so a key that holds a dot is not reachable. A path that breaks the rule is rejected by the descriptor's schema, so `configInput({ path: 'a..b' })` throws at the call as any rejected extension value does, with the issue `Supply a dotted path of nonempty keys.`
- **What a link answers.** A linked option takes the value the file holds at its path once the file has passed the schema, so a value the schema removed fills nothing, and a schema default or transform never reaches the option: the option's own default and validator decide. A path that meets a missing key, or a value that is not an object before its last segment, does not lead to a value, so the request has no answer. A run with no configuration file answers nothing.
- **Values.** A string option takes a string as it is, or a finite number as `JSON.stringify` writes it, whatever the format wrote, so `5` fills `"5"` and the option's validator decides, and TOML `5_000` and YAML `0x1F` fill `"5000"` and `"31"`. A TOML integer beyond `-(2^53 - 1)` through `2^53 - 1` fills its exact decimal digits, so `12345678901234567890` fills `"12345678901234567890"`. A TOML date or time fills its text as written in the file: `1979-05-27T07:32:00-08:00`, `1979-05-27 07:32:00`, `1979-05-27`, and `07:32:00.5` each fill as written, with no precision added and no separator changed. The YAML core schema has no date type, so `2001-12-14` is already a string. A Boolean option takes a JSON or TOML `true` or `false`, or a YAML core-schema Boolean, `true`, `True`, `TRUE`, or their `false` forms, which states the option's value, not a spelling, under every polarity, as an environment value does; a YAML `yes`, `no`, `on`, or `off` is a string. A [counted option](../core/options.md#counted-options) takes any number the format wrote that is a whole number of 0 or more, so `3`, TOML `1_0` and `3.0`, and YAML `0x3` fill `3`, `10`, `3`, and `3`, and `0` is a fill. A multiple option takes a JSON or TOML array or a YAML sequence whose items each follow the string rule, and an empty one is a fill. A string option with an [implied value](../core/options.md#implied-values) takes a value by the string rule and never its implied value.
- **A value the option cannot take.** Any other value is not answered: a JSON `null`, a YAML null, written `null`, `~`, or as a key with no value, an object, table, or mapping, a Boolean for a string option, a string for a Boolean option, a string, a Boolean, or a negative or fractional number for a counted option, a bare value for a multiple option or one with an item that breaks the string rule, and a number that is not finite, such as JSON `1e400`, which overflows to infinity, TOML `inf` and `nan`, and YAML `.inf` and `.nan`. The option falls through to its default, `provided.config` keeps the value, and the source writes one `out.debug` line in core's form for a dropped fill: `Ignored option "--min-bytes" from minBytes in .collector.toml: Use a string or a number.` A Boolean option reads `Use true or false.`, a counted option reads `Use a whole number of 0 or more.`, a multiple option given a bare value reads `Use an array of strings or numbers.`, and an array item that breaks the string rule reads its position after the option, `Ignored option "--field" at 1 from fields in .collector.toml: Use a string or a number.` The option is named by core's [`reportedSpelling`](../core/failures.md#failure-classes), `--no-<name>` included, and in an [invocation by name](../core/invocation.md#invocation-by-name) by its declared name.
- **A value the option's validator rejects.** Core drops the fill and the option falls back, with its own `-v` line, under [Input sources](../core/input-sources.md). `provided.config` keeps the value, because the schema accepted it.
- **A link the schema cannot hold.** When the schema implements `StandardJSONSchemaV1`, the plugin's `onGraphBuilt` hook reads its input-side JSON Schema, one call of `'~standard'.jsonSchema.input({ target: 'draft-2020-12' })`, and judges each option that carries `configInput`. A path whose keys the shape does not hold throws a `DeclarationError`: `@loomcli/plugins/config/link-path`, `Option "min-bytes" links to minBytes, which the configuration schema does not hold.`, corrected by `Link a path the schema describes, or add the key to the schema.` A path whose type in the shape the option cannot take under **Values**, in every branch of a union, throws under `@loomcli/plugins/config/link-type`: `Option "min-bytes" links to sessions, which holds an object.`, corrected by `Link a key that holds a value the option takes: a string or a number for a string option, a Boolean for a Boolean option, a whole number for a counted option, or an array for a multiple option.` The hook walks the shape by these keywords alone. An object holds a key that its `properties` lists. An object is open when it has `additionalProperties` or `patternProperties` with a value other than `false`, so `z.looseObject` and a record are open, while zod's and ArkType's plain objects, which name neither keyword, are judged. A `$ref` to the shape's own `$defs` is followed. Under `allOf` a key is held when any member holds it, and under `anyOf` or `oneOf` when any branch holds it. A type is judged from `type`, `const`, or `enum`; a shape that names none takes any value. A schema without a converter, such as valibot's, a converter that throws, a path that reaches an open object, and a path through an array get no check. The option is named as [Input source declaration errors](../core/input-sources.md#input-source-declaration-errors) names it.

## File-relative paths

- **A linked option.** A relative path in the file resolves against the file's directory, as tsconfig, git's `include.path`, and Cargo resolve it, for an option linked to it. Every answer the source gives carries the file's absolute `directory`, so the option's validator, such as [`path()`](../libs/validators.md), reads that directory as `host.cwd`, under [Input sources](../core/input-sources.md).
- **The schema keeps paths as written.** A Standard Schema library passes no options to the validators nested inside it, so the plugin cannot give the schema a host whose `cwd` is the file's directory, and `provided.config` holds each path as the file wrote it.
- **No `~`.** The plugin expands no `~` in a value, and neither does `path()`. A value that holds `~/notes` resolves as a relative path that starts with a folder named `~`.

## Lookup

A run reads at most one configuration file, and nothing is merged across files. The plugin tries each step in order and stops at the first that yields a file.

1. **`--config <path>`.** That file is the configuration, and the plugin looks nowhere else. The path is not a pattern, so `*` and braces in it are part of the name, a relative path resolves against `host.cwd`, and its extension chooses its parser as **Formats** states. A missing or broken file fails the run, under **The named file**.
2. **The variable.** With `env` set, the plugin reads that variable from `host.env`. A nonempty value names the configuration file, read with no search: a relative value resolves against `host.cwd`, it is not a pattern, and its extension chooses its parser. A missing file prints nothing and the run has no configuration. A broken file warns once, under **Broken files**, and the run has no configuration. An empty or unset variable is skipped.
3. **The walk.** The plugin looks for `file` in the start directory and then in each of its ancestors. When the start directory is the home directory or inside it, the walk ends at the home directory and includes it. Otherwise it ends at the filesystem root. The start directory is the directory option's value when the author declares one and the operator gives it, and `host.cwd` otherwise. The home directory is [`host.home`](../core/host.md#the-home-and-temporary-folders) on every platform, and a home that is empty or a relative path gives no home directory, so the walk ends at the root. Paths compare lexically, as `node:path` resolves them, and a file that is a symbolic link is read through it.
4. **The home file.** `file` in the home directory, when the walk did not look there.
5. **The XDG user file.** `config.<ext>` in `$XDG_CONFIG_HOME/<app>`, or in `<home>/.config/<app>` when `XDG_CONFIG_HOME` is unset, empty, or a relative path, where `<app>` is `graph.name`. Each of the pattern's candidates names one extension, in candidate order: its own when it is `json`, `toml`, `yaml`, or `yml`, and `json` otherwise, because such a name reads as JSON. An extension named twice counts once, so `.collector.{toml,json}` looks for `config.toml` and then `config.json`, and `.collectorrc` for `config.json`. With neither `XDG_CONFIG_HOME` nor a home directory there is no user file.

- **Candidates.** In each directory a step looks in, the first of the pattern's candidates that something is at is the file the plugin finds there. Every later candidate also present in that directory is skipped and never read, and the plugin writes one warning through `out.warn`, ahead of any warning about the file it found: `Skipped <file>: <chosen> matches the same pattern first. Keep one of the files, and remove the others.`, where `<file>` is every skipped candidate in candidate order, joined by `, `, and `<chosen>` is the file found, each shown as a label shows a file. A later candidate never answers in place of a broken first one.
- **No system level.** The plugin reads no machine-wide file, such as one under `/etc`.
- **The directory option.** With `directory: { name }`, the plugin declares a global string option, `--<name>`, not marked `control`, whose value replaces `host.cwd` as the walk's start directory. It does not change `host.cwd`. The action reads it as it reads any plugin option, so an application that takes a project directory uses one option for its own work and for the lookup. A relative value resolves against `host.cwd`. The plugin judges nothing about the directory: one that does not exist starts the walk there, and the walk goes on through its ancestors. `--config` and the variable still come first. The option binds no variable, and its description defaults to `Look for the configuration file from this directory.`

## Reading

- **When.** The lookup runs and the file is read the first time a run needs it: when core calls the source for an unfilled configuration-bound option, or when core builds the provider for a Command that opts in.
- **Text.** The plugin reads the file it finds as UTF-8 with a leading byte order mark ignored, and parses it with `JSON.parse`, `smol-toml`, or `yaml` by its extension, so a TOML file reads as `smol-toml` reads it, a time written without seconds included. It loads each of the two parser packages with a dynamic import only after it reads the text of a file of that kind, so a run that reads a JSON file loads neither.
- **Documents.** An empty JSON file is not valid JSON, an empty TOML file is an empty table, and an empty YAML file, or one that holds only comments, holds no mapping. A YAML file holds one document with unique keys and only the core schema's tags: a second document, a repeated key, and a tag such as `!!binary`, `!!timestamp`, or a local `!tag` make it not valid YAML. The plugin converts the document with the parser's own `toJS()`, so a key reads as `toJS()` writes it. An alias reads as the value its anchor names, with no limit on how many aliases a file holds, and an alias that names no preceding anchor makes the file not valid YAML. A TOML document is always a table at its top level.
- **Formats.** A file's extension chooses its parser: `.toml` reads as TOML through `smol-toml` (TOML 1.0, with the TOML 1.1 additions it accepts), and `.yaml` and `.yml` as YAML 1.2 under its core schema through `yaml`. Every other name reads as JSON: `.json`, a name with no extension, such as `.textstatrc`, and a name with any other extension, such as `.textstat.conf` or `config.cfg`. The rule is the same for every step of the lookup. The file name is the path's last segment, and its extension is the text after its last `.`, unless that `.` is the name's first character. Extensions compare as written, so `.TOML` reads as JSON.
- **File patterns.** `file` is a file pattern. Glob syntax, the characters `*`, `?`, `[`, `]`, `{`, and `}`, may appear only as the whole extension of its last segment, in one of two forms: `*`, which accepts any format the plugin reads, or a brace list, `{toml,yaml}`, which accepts the formats it lists and lists only `json`, `toml`, `yaml`, and `yml`. A `file` with no glob syntax is literal, and its extension locks its format, so `.textstat.conf` reads only as JSON. A pattern's candidates are, in order, the brace list's extensions as listed, an extension listed twice counting at its first position, or for `*` `toml`, `yaml`, `yml`, then `json`; a literal name is its own one candidate. After the path check, `configuration()` checks the pattern and throws a `DeclarationError` for a `file` that breaks either rule, with the finding marking `file`:
  - **Glob placement.** Glob syntax appears only as the whole extension of `*` or a brace list, never in a directory segment, in the name before its extension, or in an extension such as `t*`: [`@loomcli/plugins/config/file-pattern`](../core/diagnostics.md#loomclipluginsconfigfile-pattern).
  - **Listed extensions.** A brace list lists only `json`, `toml`, `yaml`, and `yml`, so `.textstat.{toml,ini}` and an empty item fail: [`@loomcli/plugins/config/file-pattern`](../core/diagnostics.md#loomclipluginsconfigfile-pattern). A literal name never meets this rule.

## Missing and broken files

- **Labels.** A file found in `host.cwd` shows as `file` names it, with a pattern's extension replaced by the candidate's. A file found anywhere else in the walk, the home file, and the XDG user file show as their full paths. The `--config` file and the variable's file show as the operator wrote them. An answer's label is `<path> in <file>`: `minBytes in .collector.toml`.
- **Missing files.** A step whose file does not exist, including one under a directory that does not exist or under a path component that is a file, prints nothing, and the lookup goes on to the next step, except after the variable, whose missing file ends the lookup with no configuration. With `notice: true`, a run whose lookup finds no file writes one `out.info` line: `Found no configuration file. Create <file> to configure <app>.`, where `<file>` is `file`'s first candidate in the start directory, shown as a label shows it, and `<app>` is `graph.name`. The notice is off by default, and a variable that names a missing file writes none.
- **Broken files.** A file the variable names or the lookup finds that the plugin cannot read, a directory in its place included, one that does not parse in its format, and one whose top level is not an object or a mapping are not used, and the plugin writes one warning through `out.warn`, and the run has no configuration: no later step answers in its place. The warnings read `Skipped <file>: the file could not be read, so this run reads no configuration. Make it readable, or remove it.`, `Skipped <file>: the file is not valid JSON, so this run reads no configuration. Correct its syntax, or remove it.`, `Skipped <file>: the file does not hold a JSON object, so this run reads no configuration. Write its settings as one JSON object, or remove it.`, `Skipped <file>: the file is not valid TOML, so this run reads no configuration. Correct its syntax, or remove it.`, `Skipped <file>: the file is not valid YAML, so this run reads no configuration. Correct its syntax, or remove it.`, and `Skipped <file>: the file does not hold a YAML mapping, so this run reads no configuration. Write its settings as one YAML mapping, or remove it.`
- **The named file.** A `--config` file with any of those faults fails the run. The source, or the provider when it reads first, throws an `InputError` whose one problem is `{ input: { kind: 'option', name: 'config', global: true }, spelling: '--config', reason: 'invalid', issues: [{ message: 'File "<path>" does not exist. Supply the path of an existing file.' }] }`, and stderr reads `<application>: Option "--config": File "<path>" does not exist. Supply the path of an existing file.`, opened by the application name, with `could not be read. Supply a file this process can read.`, `is not valid JSON. Correct its syntax, or supply another file.`, `does not hold a JSON object. Write its settings as one JSON object.`, `is not valid TOML. Correct its syntax, or supply another file.`, `is not valid YAML. Correct its syntax, or supply another file.`, or `does not hold a YAML mapping. Write its settings as one YAML mapping.` in place of the last clause. The problem spells the option `--config` whichever spelling the operator typed, and `config` in an [invocation by name](../core/invocation.md#invocation-by-name). The code is 2, and `--help` reports nothing, as [Input sources](../core/input-sources.md) holds every source `InputError`. A provider's `InputError` takes the ordinary failure path from the dispatch boundary with the same code.

## Text and portability

- **Text.** Every sentence the plugin writes is fixed and carries no parser message, the YAML parser's warnings included, so the bytes are the same under Node and Bun and no file content reaches the terminal at the default verbosity. A `-v` line for a removed value carries the schema's own message, which is the author's. Each character [`escapeControlCharacters`](../core/styles.md#strings-and-composition) escapes in a file path, a bound key path, or a schema message prints as that escape wherever it leaves the plugin: in an answer's label, which core prints as it is, in a warning, the candidates a several-candidates warning names included, in a `-v` line, and in a failure. A position is read with [`issuePath`](../core/failures.md#failure-classes) and escaped the same way. A warning escapes each path with `style.escape` before the call.
- **Portability.** The plugin reads files through `node:fs/promises` and joins paths through `node:path`, which Node and Bun both provide. It is the one pack module that imports either. `yaml` (ISC) and `smol-toml` (BSD-3-Clause) are runtime dependencies of `@loomcli/plugins` beside `valibot` and `@loomcli/validators`, each installed as its own package with its own license, so the pack's `license` field and NOTICE do not change.
