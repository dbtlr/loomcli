---
description: "Guide chapter 3. Move input checks out of the actions into validators, declare a default, leave an option out, and read the unit from an environment variable."
---

# Inputs and validation

In this chapter you move every input check out of `pace`'s actions and into validators, which Loom runs before an action starts. At the end, each action receives a distance in metres, a time in seconds, a pace, and a unit typed `'km' | 'mi'`, and contains no parsing code. `--unit` defaults to `km` and also reads the environment variable `PACE_UNIT`, and the help page lists the units it accepts.

The chapter starts from the code [Commands and options](commands-and-options.md) ended with. In that chapter, each action read its inputs as strings, parsed them, and called `out.fatal` when it could not read one.

## Install the validator catalog

A validator is a [Standard Schema](https://standardschema.dev/) object that you attach to an argument or an option with `validate`. Loom calls it with the text the operator typed. When the validator accepts the text, the action receives the value the validator returns. When it rejects the text, the action does not run. See [Standard Schema validation](../core/validation.md).

`@loomcli/validators` ships the validator catalog, validators for common input shapes, and `createValidator`, which builds a validator from a parse function of your own. Add it to the project:

```sh
pnpm add @loomcli/validators
```

The [validators reference](../libs/validators.md) lists every validator in the catalog.

This chapter changes these files:

- `src/application.ts`, `src/validators.ts`, `src/commands/calc.ts`, and both `calc` and `splits` actions are shown below, with the `--every` option of `src/commands/splits.ts`.
- `src/commands/splits.ts`: copy it from [the snapshot](../../examples/guide/src/03-inputs-and-validation/commands/splits.ts). Its arguments gain the validators `calc`'s arguments use.
- `src/commands/convert.ts` and `src/actions/convert.ts`: copy them from [the snapshot](../../examples/guide/src/03-inputs-and-validation/commands/convert.ts). The argument gains the `pace` validator, and the action shrinks to one line.

## Validate the unit

`--unit` accepts two values. In chapter 2 every action checked it by hand. Replace the global option in `src/application.ts` with this declaration:

<!-- example: ../../examples/guide/src/03-inputs-and-validation/application.ts -->
```ts
import { Application } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { oneOf } from '@loomcli/validators';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { splits } from './commands/splits.js';

const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  plugins: [help(), version()],
}).globalOption('unit', {
  default: 'km',
  description: 'The unit to give a pace in.',
  env: 'PACE_UNIT',
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

export const pace = configured.command(calc).command(splits).command(convert);
```

The global option has three new keys:

- **`validate: oneOf(['km', 'mi'])`** accepts a token that equals one of the listed values exactly. The value the action receives is typed as the union of the values, `'km' | 'mi'`, so it fits the `Unit` type in `src/pace.ts` with no check of its own, and the `Register` augmentation passes that type to every Command. See [oneOf](../libs/validators.md#oneof).
- **`default: 'km'`** is the value the option takes when nothing supplies it. You write a default as the text an operator would type, and it passes through the validator like a token, so the action receives `'km'` typed as the union, and `options.unit` is never `undefined`. Core [checks the default against the validator on every run](../core/validation.md#absence-and-defaults), so a default the validator rejects fails every run.
- **`env: 'PACE_UNIT'`** binds the option to an environment variable. [Read the unit from the environment](#read-the-unit-from-the-environment) covers it.

The description no longer lists the units, because the help page now prints them and the default from the declaration, as [the help section below](#help-shows-the-default-and-the-accepted-values) shows.

With no `--unit`, `pace` uses the default:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/unit-default.txt -->
```console
$ pace calc 10k 50:00
5:00 /km
```

The option selects miles:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/unit-from-option.txt -->
```console
$ pace calc 10k 50:00 --unit mi
8:03 /mi
```

A unit that `oneOf` rejects never reaches the action. Loom names the option, prints the validator's message, and exits 2, and the help plugin's hint follows:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/unknown-unit.exit-2.txt -->
```console
$ pace calc 10k 50:00 --unit miles
pace: Option "--unit": Expected one of: km, mi.
Run "pace calc --help" to see the usage.
```

In chapter 2 the action reported the same mistake with `out.fatal`, so the run exited 1. A value that a validator rejects is a usage error: the invocation itself is wrong, so Loom exits 2, as it does for a missing argument. See [Issues and validator failures](../core/validation.md#issues-and-validator-failures).

## Read the unit from the environment

An operator who always runs in miles can set `PACE_UNIT` once instead of typing `--unit mi` on each run. The `env` key names the variable that supplies the option when the command line does not:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/unit-from-environment.txt -->
```console
$ PACE_UNIT=mi pace calc 10k 50:00
8:03 /mi
```

The command line still wins. For each option, Loom takes [the first tier that supplies a value](../core/input-sources.md): the command line, then the environment, then a configuration file, then the declared default. Chapter 6 adds the configuration file. Here `--unit km` overrides `PACE_UNIT=mi`:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/option-over-environment.txt -->
```console
$ PACE_UNIT=mi pace calc 10k 50:00 --unit km
5:00 /km
```

A value from the environment passes the same validator as a value from the command line. When the validator rejects it, the message names the variable that supplied the value, so the operator knows where to correct it:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/unknown-unit-from-environment.exit-2.txt -->
```console
$ PACE_UNIT=miles pace calc 10k 50:00
pace: Option "--unit" (from PACE_UNIT): Expected one of: km, mi.
Run "pace calc --help" to see the usage.
```

The action cannot tell which tier supplied the value, so it reads `options.unit` the same way in every case. The help page [does not list an environment variable](../core/input-sources.md), because help teaches command-line syntax, so document `PACE_UNIT` wherever you document the application.

## Write validators for distance, time, and pace

The catalog has no validator for a running distance, a race time, or a pace. `createValidator` builds one from a parse function. Add `src/validators.ts`:

<!-- example: ../../examples/guide/src/03-inputs-and-validation/validators.ts -->
```ts
import { createValidator } from '@loomcli/validators';
import type { ParseResult } from '@loomcli/validators';

import { parseDistance, parsePace, parseTime } from './pace.js';
import type { Pace } from './pace.js';

/** A distance such as `10k`, `5mi`, `400m`, `half`, or `marathon`, which the action reads as metres. */
export const distance = createValidator({
  inputSchema: {
    pattern: String.raw`^(?:\d+(?:\.\d+)?(?:k|km|m|mi)|half|marathon)$`,
    type: 'string',
  },
  parse: (raw): ParseResult<number> => {
    const metres = parseDistance(raw);
    return metres === undefined
      ? {
          issues: [
            {
              message: 'Expected a distance, such as 10k, 5mi, 400m, half, or marathon.',
            },
          ],
        }
      : { value: metres };
  },
});

/** A time such as `25:30` or `1:45:00`, which the action reads as seconds. */
export const time = createValidator({
  inputSchema: { pattern: String.raw`^(?:\d+:[0-5]\d|\d+):[0-5]\d$`, type: 'string' },
  parse: (raw): ParseResult<number> => {
    const seconds = parseTime(raw);
    return seconds === undefined
      ? { issues: [{ message: 'Expected a time above zero as mm:ss or h:mm:ss, such as 25:30.' }] }
      : { value: seconds };
  },
});

/** A pace such as `5:00/km` or `8:03/mi`, which the action reads as a `Pace`. */
export const pace = createValidator({
  inputSchema: { pattern: String.raw`^(?:\d+:[0-5]\d|\d+):[0-5]\d ?/(?:km|mi)$`, type: 'string' },
  parse: (raw): ParseResult<Pace> => {
    const parsed = parsePace(raw);
    return parsed === undefined
      ? { issues: [{ message: 'Expected a time and a unit, such as 5:00/km or 8:03/mi.' }] }
      : { value: parsed };
  },
});
```

Each validator reuses a parser from `src/pace.ts`, and the definition `createValidator` takes has two members:

- **`parse`** receives the operator's text and returns a `ParseResult`: either `{ value }`, the value the action receives, or `{ issues }`, the reasons the text is rejected. `distance` returns metres, `time` returns seconds, and `pace` returns a `Pace`. The annotation `ParseResult<number>` names, in one place, the type every branch returns and the type the action receives. Each message follows [the catalog's form](../libs/validators.md#shared-rules): one sentence that begins with `Expected` and does not repeat the operator's text.
- **`inputSchema`** is the JSON Schema the validator publishes, its [input schema](../core/validation.md#input-schema). Loom does not validate with it. It tells the help page, and the manifest that chapter 7 shows to agents, what a token must look like, so a reader learns the shape without trying a value. A published schema must accept every token the validator accepts, and it may accept more, under the [soundness rule](../libs/validators.md#shared-rules).

Attach the validators to the arguments in `src/commands/calc.ts`:

<!-- example: ../../examples/guide/src/03-inputs-and-validation/commands/calc.ts -->
```ts
import { Command } from '@loomcli/core';

import { calculatePace } from '../actions/calc.js';
import { distance, time } from '../validators.js';

export const calc = new Command('calc', { description: 'Work out the pace of a run.' })
  .argument('distance', {
    description: 'How far you ran, such as 10k, 5mi, 400m, half, or marathon.',
    required: true,
    validate: distance,
  })
  .argument('time', {
    description: 'How long the run took, as mm:ss or h:mm:ss.',
    required: true,
    validate: time,
  })
  .action(calculatePace);
```

The action receives numbers now, so it shrinks to one line. Replace `src/actions/calc.ts`:

<!-- example: ../../examples/guide/src/03-inputs-and-validation/actions/calc.ts -->
```ts
import type { ActionHandler } from '@loomcli/core';

import type { calc } from '../commands/calc.js';
import { formatPace, paceOf } from '../pace.js';

export const calculatePace: ActionHandler<typeof calc> = ({ args, options, out }) =>
  out.print(formatPace(paceOf(args.distance, args.time, options.unit)));
```

`args.distance` and `args.time` are numbers, and `options.unit` is `'km' | 'mi'`, because `ActionHandler<typeof calc>` keeps the type each validator returns. `src/commands/convert.ts` attaches `pace` to its argument the same way, so [`src/actions/convert.ts`](../../examples/guide/src/03-inputs-and-validation/actions/convert.ts) receives a `Pace` and becomes one line too.

A distance that `pace` cannot read now fails before the action runs:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/bad-distance.exit-2.txt -->
```console
$ pace calc 10x 50:00
pace: Argument "distance": Expected a distance, such as 10k, 5mi, 400m, half, or marathon.
Run "pace calc --help" to see the usage.
```

Compare this with [chapter 1](first-application.md#run-it), where the action called `out.fatal` for the same input and the run exited 1. The message is the validator's, prefixed with the argument it belongs to, and the run exits 2.

## Leave an option out

`splits` attaches `distance` and `time` to its arguments as `calc` does, and `distance` to `--every` as well, so a split length reads as metres. `--every` declares no default: its fallback, one unit, is a kilometre or a mile depending on `--unit`, so the action works it out. Update the option in `src/commands/splits.ts`:

<!-- example: ../../examples/guide/src/03-inputs-and-validation/commands/splits.ts#every -->
```ts
.option('every', {
  description: 'How long each split is, such as 1k, 1mi, or 400m. Defaults to one unit.',
  short: 'e',
  type: 'string',
  validate: distance,
})
```

When the operator leaves out an optional option that has no default, the action receives `undefined` and [Loom does not call the validator](../core/validation.md#absence-and-defaults). So `options.every` is typed `number | undefined`, and the action supplies the fallback itself. Replace `src/actions/splits.ts`:

<!-- example: ../../examples/guide/src/03-inputs-and-validation/actions/splits.ts -->
```ts
import type { ActionHandler } from '@loomcli/core';

import type { splits } from '../commands/splits.js';
import { formatSplit, splitRun, unitLength } from '../pace.js';

export const printSplits: ActionHandler<typeof splits> = async ({ args, options, out }) => {
  const { distance: metres, time: seconds } = args;
  const { negative, unit } = options;
  // With no --every, each split is one unit long.
  const every = options.every ?? unitLength(unit);
  for (const split of splitRun({ every, metres, negative, seconds, unit })) {
    await out.print(formatSplit(split));
  }
};
```

With no `--every`, each split is one unit long. Here `PACE_UNIT` selects miles, so each split is one mile:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/every-defaults-to-one-unit.txt -->
```console
$ PACE_UNIT=mi pace splits 5mi 40:00
1 mi  8:00  8:00
2 mi  8:00  16:00
3 mi  8:00  24:00
4 mi  8:00  32:00
5 mi  8:00  40:00
```

## Help shows the default and the accepted values

The help page reads each input schema and default from the declaration:

<!-- transcript: ../../examples/guide/transcripts/03-inputs-and-validation/calc-help.txt -->
```console
$ pace calc --help
pace calc · Work out the pace of a run.

USAGE
  pace calc <distance> <time> [options]

ARGUMENTS
  distance  How far you ran, such as 10k, 5mi, 400m, half, or marathon.
  time      How long the run took, as mm:ss or h:mm:ss.

GLOBAL OPTIONS
  -u, --unit <unit>  The unit to give a pace in. One of: km, mi.  (default: km)
  -h, --help         Show this help.
  -V, --version      Print the version.
```

The `--unit` row now ends with `One of: km, mi.` and `(default: km)`, which you no longer write in the description:

- **`One of: km, mi.`** is the [accepted-values sentence](../plugins/help.md#accepted-values). The help plugin derives it from the input schema when the schema is a closed set of strings, as the one `oneOf` publishes is.
- **`(default: km)`** is the declared default, which the help page [prints as a fact](../plugins/help-page.md#the-help-page) after the description.

The `distance` and `time` rows show no accepted values, because their input schemas hold a `pattern` rather than a closed set. Their descriptions keep the examples that tell the operator what to type.

## Next

Each action now receives typed values and prints a line. In [Results and views](results-and-views.md), `splits` and `calc` declare the results they produce, render them as a table or records, and let the operator choose JSON.
