---
description: "Guide chapter 6. Install suggestions, completion, and the configuration plugin, read the unit from a configuration file, and write a plugin of your own with an onFailure hook."
---

# Plugins

In this chapter you install three more first-party plugins and write one of your own. At the end, `pace calcc` suggests `calc`, an operator can install tab completion for `pace`, a `.pace.json` file can set the unit, `pace races` lists the races `pace` knows by name, and a distance that `pace` cannot read gets one more line that points at that list.

Every capability beyond declaring Commands and running them is a plugin that you install. [Core installs no plugin](../core/plugin-contract.md), and a first-party plugin uses the same public contract as one you write. The chapter starts from the code [Failures](failures.md) ended with.

## Install the plugins

The plugins come from `@loomcli/plugins`, which you added in chapter 1. Each plugin has its own subpath, so `pace` imports only the plugins it installs. [First-party plugins](../plugins/README.md) lists every plugin in the pack, with the moment to open each page.

Add `suggestions()`, `config()`, and `completion()` to the `plugins` list, bind `--unit` to the configuration file with `configInput`, and install `raceHint()`, the plugin you write later in this chapter. Attach `races`, a Command you also write later, after the other Commands:

<!-- example: ../../examples/guide/src/06-plugins/application.ts -->
```ts
import { Application, InternalError, override } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { completion } from '@loomcli/plugins/completion';
import { config } from '@loomcli/plugins/config';
import { configInput } from '@loomcli/plugins/config/extension';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { suggestions } from '@loomcli/plugins/suggestions';
import { version } from '@loomcli/plugins/version';
import { oneOf } from '@loomcli/validators';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { races } from './commands/races.js';
import { splits } from './commands/splits.js';
import { splitTooLong } from './failures.js';
import { raceHint } from './race-hint.js';
import { defectView } from './views.js';

const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  // Installation order is composition order: help and version answer before any later plugin.
  plugins: [help(), suggestions(), version(), format(), config(), completion(), raceHint()],
  translators: [splitTooLong],
  views: [override(InternalError, defectView)],
}).globalOption('unit', {
  default: 'km',
  description: 'The unit to give a pace in.',
  env: 'PACE_UNIT',
  // An operator can set the unit in .pace.json, in the working directory or the home directory.
  extensions: [configInput({ path: 'unit' })],
  short: 'u',
  type: 'string',
  validate: oneOf(['km', 'mi']),
});

// Each Command reads the types of the global options through this registration.
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const pace = configured.command(calc).command(splits).command(convert).command(races);
```

Each factory call returns a plugin, a frozen value that runs none of its code until core calls it. The `plugins` list is the only way to install one: there is no install call on the chain and no default set, so the list shows everything `pace` has beyond its own declarations.

## Order the plugins

The order of the list matters. [Installation order](../core/plugin-contract.md#identity-and-installation) is the order every plugin's contributions compose in, so you read the precedence from the source:

- **The middleware chain.** Plugins that act on an invocation, as help acts on `--help`, run their [middleware](../core/middleware.md) in installation order, and the first one that takes over ends the invocation. Help comes before version, so `pace --version --help` prints the help page, and the version plugin's middleware never loads.
- **Views and overrides.** When two plugins override the same view, the first one installed wins, and an override the application declares wins over every plugin's. [Views](../core/views.md) states the walk.
- **Hints.** A hint is a line a plugin adds under a failure message. The hints of every installed plugin accumulate in installation order, under [Failure hints](../core/lifecycle-hooks.md#failure-hints).
- **Global options.** The [graph](../core/graph-inspection.md) lists the application's global options, then each plugin's in installation order, and the help page lists them in that order.

A plugin's place in the list matters only for the contributions it makes. The suggestions plugin has no middleware, so its place changes no takeover, and [its page](../plugins/suggestions.md) places no rule on where you install it.

## Suggest the closest name

The [suggestions plugin](../plugins/suggestions.md) changes the failure for an unknown Command or option. When the typed name is close to a declared one, the message offers the declared name as the fix:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/suggest-command.exit-2.txt -->
```console
$ pace calcc 10k 50:00
pace: Unknown command "calcc". Did you mean "calc"?
Run "pace --help" to see the usage.
```

A mistyped option gets the same treatment. The candidates are the global options and the routed Command's own options, so `--unti` on `calc` suggests `--unit`:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/suggest-option.exit-2.txt -->
```console
$ pace calc 10k 50:00 --unti km
pace: Unknown option "--unti". Did you mean "--unit"?
Run "pace calc --help" to see the usage.
```

The last line of each message is the help plugin's hint. When no declared name is close, the plugin prints core's own message unchanged. The plugin's page states which names are candidates and how close a name must be.

## Offer shell completion

The [completion plugin](../plugins/completion.md) adds a `completion` Command. An operator runs it once to install a completion script for their shell:

```sh
pace completion install
```

From then on, pressing Tab after `pace` completes the names of Commands and options, and the values an option accepts, such as `km` and `mi` for `--unit`. The script asks `pace` for the answer at each Tab and holds no copy of the Commands, so it stays correct as `pace` grows. [Installing completion](../plugins/completion.md#installing-completion) describes which shells it supports and what the install changes.

## Read the unit from a configuration file

The [configuration plugin](../plugins/config.md) reads option values from one configuration file per run. With no settings, `config()` looks for `.pace.json`, the application name with a leading dot and a `.json` extension, first in the working directory and then in the operator's home directory. It also adds a `--config` option, which names the one file to read for a run.

The plugin fills only the options you bind to the file. `configInput({ path: 'unit' })` on `--unit` is that binding: an [extension](../core/extensions.md) value, a typed fact that the configuration plugin defines and the option carries. Its `path` names the key in the file. The binding comes from `@loomcli/plugins/config/extension`, the module of the plugin's declarations.

An operator who runs in miles writes this `.pace.json`:

```json
{ "unit": "mi" }
```

Every run in that directory now gives paces in miles:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/unit-from-config.txt -->
```console
$ pace calc 10k 50:00
8:03 /mi
```

The file is one of four places `--unit` can get its value. For each option, the first of these that supplies a value wins: the command line, then the environment, then the configuration file, then the declared default. Core owns the order, and no plugin changes it. [Input sources](../core/input-sources.md) states the rule.

So `PACE_UNIT`, which [chapter 3](inputs-and-validation.md) bound, wins over the file:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/environment-beats-config.txt -->
```console
$ PACE_UNIT=km pace calc 10k 50:00
5:00 /km
```

And `--unit` on the command line wins over both:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/option-beats-config.txt -->
```console
$ pace calc 10k 50:00 --unit km
5:00 /km
```

In these two runs, nothing is left for the file to fill, so the plugin does not read it. A value from the file passes through the option's validator as a typed one does, and a failure on it names the file and the key. The configuration plugin's page lists the formats it reads and how it reports a broken file.

## List the races

`pace` reads `half` and `marathon` as distances. The validator's message names them but not how far each one is, so give the operator a Command that lists the races with their distances. Move the race table in `src/pace.ts` into an exported list, which `parseDistance` reads too:

<!-- example: ../../examples/guide/src/06-plugins/pace.ts#known-races -->
```ts
/** The races pace knows by name. `5k` and `10k` read as distances too. */
export const knownRaces: readonly Race[] = [
  { metres: 5000, name: '5k' },
  { metres: 10_000, name: '10k' },
  { metres: 21_097.5, name: 'half' },
  { metres: 42_195, name: 'marathon' },
];
```

`Race`, an interface beside the other domain types, names the two fields. The table lists `5k` and `10k` as well, because runners name those races too. Create `src/commands/races.ts`:

<!-- example: ../../examples/guide/src/06-plugins/commands/races.ts -->
```ts
import { Command } from '@loomcli/core';
import { table } from '@loomcli/plugins/table';

import { listRaces } from '../actions/races.js';
import type { Race } from '../pace.js';
import { kilometresCell } from '../views.js';

export const races = new Command('races', { description: 'List the races pace knows by name.' })
  .rows<Race>({
    views: {
      table: table({
        columns: [
          { header: 'RACE', key: 'name' },
          { align: 'right', format: kilometresCell, header: 'DISTANCE', key: 'metres' },
        ],
      }),
    },
  })
  .action(listRaces);
```

`races` produces rows and renders them through the table view, as `splits` does since chapter 4. `kilometresCell` is a cell function in `src/views.ts`, and the action in [`src/actions/races.ts`](../../examples/guide/src/06-plugins/actions/races.ts) returns `out.results(knownRaces)`.

<!-- transcript: ../../examples/guide/transcripts/06-plugins/races.txt -->
```console
$ pace races
RACE        DISTANCE
5k              5 km
10k            10 km
half      21.0975 km
marathon   42.195 km
```

## Write a plugin of your own

A line under a failure message is a hint, and a hint comes from an `onFailure` hook. Hooks belong to plugins, so an application that observes a run through a hook installs a plugin of its own, under [Failure hints](../core/lifecycle-hooks.md#failure-hints). Pace's plugin points an operator who typed an unreadable distance at `pace races`, and it uses the same contract the first-party plugins use. A plugin can attach Commands as well, but a plugin builds its Commands in its own compilation, so `races` is `pace`'s Command and not the plugin's, under [Plugin Commands](../core/plugin-contract.md#plugin-commands). Write the plugin in `src/race-hint.ts`:

<!-- example: ../../examples/guide/src/06-plugins/race-hint.ts -->
```ts
import { InputError, plugin } from '@loomcli/core';
import type { FailureHook, InputProblem, Plugin } from '@loomcli/core';

/** Whether a problem is a distance pace could not read. */
function isDistance(problem: InputProblem): boolean {
  return problem.reason === 'invalid' && ['distance', 'every'].includes(problem.input.name);
}

/**
 * Points at `pace races` under a failure for a distance pace could not read. A run by name has no
 * command line to point at, so it gets no hint.
 */
const pointAtRaces: FailureHook = (failure, { invokedBy }) =>
  invokedBy === 'argv' && failure instanceof InputError && failure.problems.some(isDistance)
    ? 'Run "pace races" to list the races pace knows by name.'
    : undefined;

/** Pace's own plugin. It uses the plugin contract every first-party plugin uses. */
export function raceHint(): Plugin {
  return plugin('pace/races', { onFailure: pointAtRaces });
}
```

Read it from the bottom:

- **`plugin(identity, definition)`** builds the plugin, the same call the first-party plugins make. The identity names the plugin. By [convention](../core/plugin-contract.md#identity-and-installation), a plugin local to an application names itself under the application's name, so this one is `pace/races`.
- **`raceHint()`** is a factory, as `help()` and `config()` are, so the application installs it with a call like any other plugin.
- **`onFailure`** is a [lifecycle hook](../core/lifecycle-hooks.md), a function core calls at a named point in a run. Core calls `onFailure` for each failure a run renders, and the hook returns a hint, several hints, or `undefined` for none.
- **`pointAtRaces`** returns its hint only for an `InputError` that holds a problem for the `distance` argument or the `--every` option. An `InputError` lists its problems in `problems`, and an `invalid` problem names the input a validator rejected, as [Failure classes](../core/failures.md#failure-classes) shows. The hint points at a command line, so the hook reads `invokedBy` and returns `undefined` for a run by name, which has none, as [Failure hints](../core/lifecycle-hooks.md#failure-hints) asks. For any other failure, it returns `undefined` too.

A hint is a pointer: it names where to go next and leaves the failure's own sentence as it is. A mistyped race now gets the validator's message, help's hint, and the race hint, in installation order:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/race-hint.exit-2.txt -->
```console
$ pace calc marathn 3:30:00
pace: Argument "distance": Expected a distance, such as 10k, 5mi, 400m, half, or marathon.
Run "pace calc --help" to see the usage.
Run "pace races" to list the races pace knows by name.
```

`help()` is first in the list and `raceHint()` is last, so help's line comes first. A split length that `pace` cannot read gets the same pointer, because `--every` reads a distance too:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/race-hint-every.exit-2.txt -->
```console
$ pace splits 10k 50:00 --every 10x
pace: Option "--every": Expected a distance, such as 10k, 5mi, 400m, half, or marathon.
Run "pace splits --help" to see the usage.
Run "pace races" to list the races pace knows by name.
```

## Read the help page

The help page shows what the plugins added:

<!-- transcript: ../../examples/guide/transcripts/06-plugins/help.txt -->
```console
$ pace --help
pace · Work out running paces, splits, and conversions.

USAGE
  pace <command> [options]

COMMANDS
  completion <command>  Print or install a shell completion script.
  calc                  Work out the pace of a run.
  splits                List the time of each split of a run.
  convert               Give a pace per kilometre as a pace per mile, or the other way round.
  races                 List the races pace knows by name.

GLOBAL OPTIONS
  -u, --unit <unit>      The unit to give a pace in. One of: km, mi.  (default: km)
  -h, --help             Show this help.
  -V, --version          Print the version.
      --config <config>  Read configuration from this file alone.

Run pace <command> --help for command details.
```

- **`completion`** is listed first. Core attaches a [plugin Command](../core/plugin-contract.md#plugin-commands) to the root ahead of the application's own Commands, and it is an ordinary Command in every other way.
- **`--config`** follows help's and version's options, because `config()` is installed after them. `--unit` comes first, because the application's own global options come before every plugin's.
- **`races`** comes last, because `pace` attaches it after its other Commands.
- **`raceHint()`** adds nothing to the page, because its one contribution is a hook.

## Next

`pace` now suggests names, completes in the shell, reads a configuration file, and adds its own hints. In [Agents](agents.md), it describes itself to agents through the manifest and MCP, and you call a Command by name from code.
