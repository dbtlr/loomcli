---
description: "Guide chapter 2. Turn pace into a group of three Commands, each in its own module, with a global option, local options, and an alias."
---

# Commands and options

In this chapter you turn `pace` into a group of three Commands: `calc` works out the pace of a run, `splits` lists the time of each split, and `convert` gives a pace per kilometre as a pace per mile. Each Command lives in its own module, a global option `--unit` gives every answer in kilometres or miles, and `pace --help` lists the Commands with their descriptions.

The code is in [`examples/guide/src/02-commands-and-options/`](../../examples/guide/src/02-commands-and-options). Compare it with the code of [chapter 1](../../examples/guide/src/01-first-application) to see every change.

## Lay out the modules

A [Command](../glossary.md#authoring) is a declaration with a name, its own arguments and options, and at most one action. The Application owns an unnamed root Command, and you attach named Commands to it. A Command that has children and registers no action is a [group](../core/commands.md#nested-commands-and-groups): routing passes through it to one of its children and never runs it. In this chapter the root becomes a group.

You can declare every Command in `src/application.ts`. `pace` gives each Command a module of its own instead, and puts each action in a module beside it, the layout [Modular authoring](../core/commands.md#modular-authoring) describes:

```text
src/
  application.ts      the Application, its global option, and its Commands
  main.ts             unchanged from chapter 1
  pace.ts             the arithmetic
  commands/
    calc.ts           one declaration per Command
    splits.ts
    convert.ts
  actions/
    calc.ts           one action per Command
    splits.ts
    convert.ts
```

This chapter changes these files:

- `src/application.ts`, `src/commands/calc.ts`, `src/actions/calc.ts`, and `src/commands/splits.ts` are shown below.
- `src/pace.ts`: copy it from [the snapshot](../../examples/guide/src/02-commands-and-options/pace.ts). It still knows nothing about Loom, and it gains the functions the new Commands call, such as `parseUnit`, `splitRun`, and `convertPace`.
- `src/actions/splits.ts`: create it from [the snapshot](../../examples/guide/src/02-commands-and-options/actions/splits.ts). It reads its distance, time, and unit as `calc`'s action does, and it is `async`, because it awaits each line it prints. A section below shows the part that reads its options.
- `src/commands/convert.ts` and `src/actions/convert.ts`: create them from [the snapshot](../../examples/guide/src/02-commands-and-options/commands/convert.ts). They follow the pattern of `calc`.

## Declare the global option

Replace `src/application.ts` with this declaration:

<!-- example: ../../examples/guide/src/02-commands-and-options/application.ts -->
```ts
import { Application } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { splits } from './commands/splits.js';

const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  plugins: [help(), version()],
}).globalOption('unit', {
  description: 'The unit to give a pace in, km or mi.',
  short: 'u',
  type: 'string',
});

// Each Command reads the types of the global options through this registration.
declare module '@loomcli/core' {
  interface Register {
    environment: EnvironmentOf<typeof configured>;
  }
}

export const pace = configured.command(calc).command(splits).command(convert);
```

Read it from the top:

- **`new Application('pace', options)`** keeps its name and plugins. The description now describes the whole application, because the root no longer does one job.
- **`.globalOption('unit', config)`** declares a [global option](../glossary.md#authoring): every Command accepts it, and its value reaches every action. Its config takes the keys of a local option, here a `description`, a short name `u`, and the `string` type. Declare global options before the first `command()` call, because `command()` returns an Application that offers no `globalOption()`, as the table in [Application declarations](../core/application.md) shows.
- **No presence rule.** A global option [cannot be `required`](../core/commands.md), because the rule would fail every Command that never reads it. When the operator omits `--unit`, its value is `undefined`, and each action chooses kilometres.
- **`declare module '@loomcli/core'`** is the [application registration](../glossary.md#authoring). A Command in another module imports neither the Application nor its global options, so this augmentation of the `Register` interface gives every Command in the TypeScript project the type of `options.unit`. Register `configured`, the Application before any Command is attached, because the finished `pace` depends on the Commands that read the registration. Keep one registration per TypeScript project. [Modular authoring](../core/commands.md#modular-authoring) explains both rules.
- **`configured.command(calc)`** attaches a Command to the root and returns a new Application. Keep the value the last call returns: the exported `pace` holds all three Commands. `src/main.ts` imports `pace` and runs it, so it does not change.

## Declare a Command

Create `src/commands/calc.ts`. It holds the arguments the root declared in chapter 1:

<!-- example: ../../examples/guide/src/02-commands-and-options/commands/calc.ts -->
```ts
import { Command } from '@loomcli/core';

import { calculatePace } from '../actions/calc.js';

export const calc = new Command('calc', { description: 'Work out the pace of a run.' })
  .argument('distance', {
    description: 'How far you ran, such as 10k, 5mi, 400m, half, or marathon.',
    required: true,
  })
  .argument('time', {
    description: 'How long the run took, as mm:ss or h:mm:ss.',
    required: true,
  })
  .action(calculatePace);
```

- **`new Command('calc', options)`** names the Command. The operator types the name after `pace`, so it follows the same [portable name](../glossary.md#names-and-routing) rule as the application name. The `description` appears beside the name on the group's help page.
- **`.argument()`** declares the same two arguments as chapter 1, now on `calc` alone.
- **`.action(calculatePace)`** registers an action that another module exports. Keep `.action()` as the last call in the declaration, because the action's type reads the declaration, as [Modular authoring](../core/commands.md#modular-authoring) explains.

## Write the action in its own module

Create `src/actions/calc.ts`. The action is chapter 1's action, with the unit read from the global option:

<!-- example: ../../examples/guide/src/02-commands-and-options/actions/calc.ts -->
```ts
import type { ActionHandler } from '@loomcli/core';

import type { calc } from '../commands/calc.js';
import { formatPace, paceOf, parseDistance, parseTime, parseUnit } from '../pace.js';

export const calculatePace: ActionHandler<typeof calc> = ({ args, options, out, style }) => {
  const metres =
    parseDistance(args.distance) ??
    out.fatal(
      `Cannot read the distance "${style.escape(args.distance)}". Write one such as 10k, 5mi, 400m, half, or marathon.`,
    );
  const seconds =
    parseTime(args.time) ??
    out.fatal(
      `Cannot read the time "${style.escape(args.time)}". Write it as mm:ss or h:mm:ss, such as 25:30.`,
    );
  const unitName = options.unit ?? 'km';
  const unit =
    parseUnit(unitName) ?? out.fatal(`Unknown unit "${style.escape(unitName)}". Use km or mi.`);
  return out.print(formatPace(paceOf(metres, seconds, unit)));
};
```

- **`ActionHandler<typeof calc>`** derives the type of the action's context from the declaration, so `args.distance` is a `string` and `options.unit` is `string | undefined`. The registration supplies the type of `unit`. [Modular authoring](../core/commands.md#modular-authoring) describes `ActionHandler` and the helpers beside it.
- **`import type`** imports the declaration's type and no value, so the action module never loads the Command module. `commands/calc.ts` imports the action as a value, and the two modules form no cycle.
- **`options`** holds the values of the global options and of the routed Command's own options. A local option of another Command [never appears in it](../core/commands.md).

The action checks the unit by hand. It reads `options.unit`, chooses `km` when the value is `undefined`, and calls `out.fatal` when the text is neither `km` nor `mi`. The `splits` and `convert` actions repeat the same three lines. Chapter 3 removes that repetition: a validator on the global option checks the unit once, before any action runs.

Run the Command by its name:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/calc.txt -->
```console
$ pace calc 10k 50:00
5:00 /km
```

The operator can write `--unit` after the arguments, because [every Command accepts every global option](../core/commands.md#global-consumption-and-routing):

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/calc-in-miles.txt -->
```console
$ pace calc half 1:45:00 --unit mi
8:01 /mi
```

A unit that the action cannot read ends with the action's message and exits 1:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/unknown-unit.exit-1.txt -->
```console
$ pace calc 10k 50:00 --unit miles
Unknown unit "miles". Use km or mi.
```

## Add local options and an alias

Create `src/commands/splits.ts`. The `splits` Command declares an alias and two [local options](../glossary.md#inputs), options that only this Command accepts:

<!-- example: ../../examples/guide/src/02-commands-and-options/commands/splits.ts -->
```ts
import { Command } from '@loomcli/core';

import { printSplits } from '../actions/splits.js';

export const splits = new Command('splits', {
  description: 'List the time of each split of a run.',
})
  .alias('split')
  .argument('distance', {
    description: 'How far the run goes, such as 10k, 5mi, half, or marathon.',
    required: true,
  })
  .argument('time', {
    description: 'The time to finish in, as mm:ss or h:mm:ss.',
    required: true,
  })
  .option('every', {
    description: 'How long each split is, such as 1k, 1mi, or 400m. Defaults to one unit.',
    short: 'e',
    type: 'string',
  })
  .option('negative', {
    description: 'Run the second half faster than the first.',
    short: 'n',
    type: 'boolean',
  })
  .action(printSplits);
```

- **`.alias('split')`** routes the word `split` to `splits`. An [alias](../glossary.md#names-and-routing) is an unadvertised synonym for a common mistype or a guess: an operator or an agent who types `split` still reaches the Command, but no help page or list of Commands shows the alias, and every diagnostic names `splits`. Declare an alias before the action, because `.action()` returns a value that offers no `.alias()`. See [Aliases](../core/commands.md#aliases).
- **`.option('every', config)`** declares a string option, which takes a value. The operator writes `--every 5k`, `--every=5k`, or `-e 5k` with the short name `e`. When the operator omits it, its value is `undefined`. [String values and token consumption](../core/options.md#string-values-and-token-consumption) lists every form.
- **`.option('negative', config)`** declares a Boolean option, which takes no value. `--negative` or `-n` gives `true`, and its value is [`false` when the operator omits it](../core/options.md#boolean-polarity).
- **`description`** on each option appears beside the option on the Command's help page.

[Local options](../core/options.md) describes every kind of option and every key its config takes.

The action in `src/actions/splits.ts` reads its distance, time, and unit as `calculatePace` does. Then it reads its own options:

<!-- example: ../../examples/guide/src/02-commands-and-options/actions/splits.ts#every -->
```ts
// With no --every, each split is one unit long.
const everyText = options.every;
const every =
  everyText === undefined
    ? unitLength(unit)
    : (parseDistance(everyText) ??
      out.fatal(
        `Cannot read the split "${style.escape(everyText)}". Write one such as 1k, 1mi, or 400m.`,
      ));
for (const split of splitRun({ every, metres, negative: options.negative, seconds, unit })) {
  await out.print(formatSplit(split));
}
```

`options.every` and `options.negative` have the types their declarations give them: `string | undefined` and `boolean`. With no `--every`, each split is one unit long, and the action prints one line for each split: where the split ends, the split's own time, and the time from the start.

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/splits.txt -->
```console
$ pace splits 5k 25:00
1 km  5:00  5:00
2 km  5:00  10:00
3 km  5:00  15:00
4 km  5:00  20:00
5 km  5:00  25:00
```

The alias and the short names reach the same Command and options. With `-n`, the first half runs slower than the average and the second half faster:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/splits-negative.txt -->
```console
$ pace split half 1:45:00 -e 5k -n
5 km  25:23  25:23
10 km  25:23  50:46
15 km  24:30  1:15:16
20 km  24:23  1:39:39
21.1 km  5:21  1:45:00
```

## Add the convert Command

[`src/commands/convert.ts`](../../examples/guide/src/02-commands-and-options/commands/convert.ts) declares one argument, `pace`, and [`src/actions/convert.ts`](../../examples/guide/src/02-commands-and-options/actions/convert.ts) converts it to the unit that `--unit` names. With both in place, `pace` has all three Commands that `src/application.ts` attaches:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/convert.txt -->
```console
$ pace convert 8:03/mi
5:00 /km
```

A global option can also come before the Command's name. Here `-u` is the short name of `--unit`:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/convert-to-miles.txt -->
```console
$ pace -u mi convert 5:00/km
8:03 /mi
```

## Read the help pages

The root's help page now lists the Commands, each with its description, in the order you attached them:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/help.txt -->
```console
$ pace --help
pace · Work out running paces, splits, and conversions.

USAGE
  pace <command> [options]

COMMANDS
  calc     Work out the pace of a run.
  splits   List the time of each split of a run.
  convert  Give a pace per kilometre as a pace per mile, or the other way round.

GLOBAL OPTIONS
  -u, --unit <unit>  The unit to give a pace in, km or mi.
  -h, --help         Show this help.
  -V, --version      Print the version.

Run pace <command> --help for command details.
```

`--help` and `--version` are global options too: the help and version plugins declare them, and every Command accepts them. In chapter 1 the page listed them under OPTIONS, because [a root with no children lists its global options there](../plugins/help-page.md#the-help-page).

Each Command has its own help page. It lists the Command's arguments, its local options under OPTIONS, and the global options under GLOBAL OPTIONS:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/splits-help.txt -->
```console
$ pace splits --help
pace splits · List the time of each split of a run.

USAGE
  pace splits <distance> <time> [options]

ARGUMENTS
  distance  How far the run goes, such as 10k, 5mi, half, or marathon.
  time      The time to finish in, as mm:ss or h:mm:ss.

OPTIONS
  -e, --every <every>  How long each split is, such as 1k, 1mi, or 400m. Defaults to one unit.
  -n, --negative       Run the second half faster than the first.

GLOBAL OPTIONS
  -u, --unit <unit>  The unit to give a pace in, km or mi.
  -h, --help         Show this help.
  -V, --version      Print the version.
```

Neither page shows the alias `split`.

## Type a command that does not exist

When the first word names no Command, routing fails before any action runs. Loom lists the names of the root's Commands and exits 2, the status of a [usage error](../core/failures.md#failure-classes), and the help plugin's hint points at the help page:

<!-- transcript: ../../examples/guide/transcripts/02-commands-and-options/unknown-command.exit-2.txt -->
```console
$ pace calculate 10k 50:00
pace: Unknown command "calculate". Use one of: calc, splits, convert.
Run "pace --help" to see the usage.
```

The list holds each Command's name and never an alias.

## Next

Each action still reads its inputs as text and checks them by hand, and all three repeat the check of the unit. In [Inputs and validation](inputs-and-validation.md), validators check the inputs before any action runs, so each action receives a distance, a time, and a unit it can use.
