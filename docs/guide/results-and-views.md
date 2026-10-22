---
description: "Guide chapter 4. Declare what each Command produces, render it through its own view, a table, or records, and install the formatter so an operator can choose JSON."
---

# Results and views

In this chapter each of `pace`'s Commands declares the value it produces, and its action hands that value to Loom instead of printing lines. At the end, `pace splits 5k 25:00` prints a table, `--format records` prints the same splits as one block per split, and `--format json` prints them as JSON for a script, all from one array the action emits.

## Why a Command declares its result

Until now each action has built the text it prints. The splits action wrote one line per split with `out.print`, so the only output `pace splits` has is those lines. A person reads them well, but a script that wants the elapsed time of the third split has to parse text that was laid out for a person.

A [result](../core/results.md) is the typed value a Command produces for its consumer, as distinct from the messages it writes about its work. The Command declares the result's type and a record of views, and the action emits the value once. A [view](../core/output.md#rendered-output) turns the value into text, so one value has many projections: a person gets a table, a script gets JSON, and an agent reads the same facts through the views that declare a [media type](../core/results.md#media-types). The action never decides which one a run prints.

The change comes in three steps: give `calc` a result with a view of its own, give `splits` rows with a table and a records view, and install the formatter so the operator can choose a view by name.

## Declare a result for calc

`calc` produces one value, a `Pace`, which `src/pace.ts` already defines: the seconds per unit and the unit. A view for it is a plain object with a `render` function. Put the views in a module of their own, `src/views.ts`:

<!-- example: ../../examples/guide/src/04-results-and-views/views.ts -->
```ts
import type { View } from '@loomcli/core';

import { formatDuration, formatPace } from './pace.js';
import type { Pace, Split } from './pace.js';

/** The default view of a pace result: one line, such as `5:00 /km`. */
export const paceView: View<Pace> = {
  render: (pace) => `${formatPace(pace)}\n`,
};

/** A split's distance cell, such as `5 km`. */
export function distanceCell(distance: number, split: Readonly<Split>): string {
  return `${String(distance)} ${split.unit}`;
}

/** A cell that holds a duration in seconds, such as `25:00`. */
export function durationCell(seconds: number): string {
  return formatDuration(seconds);
}
```

`paceView` renders a pace as the line `calc` printed before, such as `5:00 /km`, and ends it with a newline, because core writes the text the view returns as it is, as [Emitting a result](../core/results.md#emitting-a-result) states. Its `render` function also receives a view context, with `style`, `columns`, and the other members [Rendered output](../core/output.md#rendered-output) lists, which `paceView` does not need. The view is declared in its own constant, so it states its data type, `View<Pace>`. The two cell functions below it are for `splits`, later in this chapter.

Then declare the result on the Command, before its action:

<!-- example: ../../examples/guide/src/04-results-and-views/commands/calc.ts -->
```ts
import { Command } from '@loomcli/core';

import { calculatePace } from '../actions/calc.js';
import type { Pace } from '../pace.js';
import { distance, time } from '../validators.js';
import { paceView } from '../views.js';

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
  .result<Pace>({ views: { text: paceView } })
  .action(calculatePace);
```

- **`.result<Pace>(declaration)`** declares that `calc` produces one `Pace`. You state the type, and it rides in the Command's declared types beside its arguments and options. `.action()` removes `.result()`, so a result declared after the action is a compile error. [Declaring a result](../core/results.md#declaring-a-result) states both rules.
- **`views`** is a record keyed by view name. The first key is the default view, the one a run renders when nothing selects another. Core knows no view name of its own, so `text` is a name `pace` chose, not one Loom reserves.

The action now emits the pace instead of printing it:

<!-- example: ../../examples/guide/src/04-results-and-views/actions/calc.ts -->
```ts
import type { ActionHandler } from '@loomcli/core';

import type { calc } from '../commands/calc.js';
import { paceOf } from '../pace.js';

export const calculatePace: ActionHandler<typeof calc> = ({ args, options, out }) =>
  out.results(paceOf(args.distance, args.time, options.unit));
```

`ActionHandler<typeof calc>` types `out.results` from the declaration, so passing anything but a `Pace` is a compile error. The action emits its result once. An action that returns without calling `out.results`, or calls it twice, fails with a `ResultError`, as [Emitting a result](../core/results.md#emitting-a-result) states. The formatting call is gone from the action, because the view does it now.

`pace calc` prints what it printed before:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/calc.txt -->
```console
$ pace calc 10k 50:00
5:00 /km
```

`convert` also produces a `Pace`, so it makes the same change: it declares `.result<Pace>({ views: { text: paceView } })`, and its action emits `convertPace(args.pace, options.unit)` through `out.results`.

## Stdout belongs to the result

On a Command that declares a result, the result is the only thing the action writes to stdout. The action's `out.print` and `out.render` keep their signatures and write to stderr instead, beside `out.info` and `out.warn`. A script that captures the stdout of `pace calc` receives the pace and nothing else, whichever view ran, even after a later change adds a progress line or a warning to the action. [Stdout belongs to the result](../core/results.md#stdout-belongs-to-the-result) states the rule.

## Declare rows for splits

`splits` produces a sequence of `Split` values, one per split, each with its number, the distance at its end, its own time, and the time elapsed. A sequence is declared with `.rows<Row>()` rather than `.result<Value>()`. Declare it with two views from the plugin pack, `table` from `@loomcli/plugins/table` and `records` from `@loomcli/plugins/records`:

<!-- example: ../../examples/guide/src/04-results-and-views/commands/splits.ts#rows -->
```ts
// The first view, the table, is the one a run renders unless --format names another.
.rows<Split>({
  views: {
    table: table({
      columns: [
        { align: 'right', header: 'SPLIT', key: 'split' },
        { align: 'right', format: distanceCell, header: 'DISTANCE', key: 'distance' },
        { align: 'right', format: durationCell, header: 'TIME', key: 'time' },
        { align: 'right', format: durationCell, header: 'ELAPSED', key: 'elapsed' },
      ],
    }),

    records: records({
      fields: [
        'split',
        { format: distanceCell, key: 'distance' },
        { format: durationCell, key: 'time' },
        { format: durationCell, key: 'elapsed' },
      ],
      identifier: 'split',
    }),
  },
})
.action(listSplits);
```

- **`.rows<Split>(declaration)`** declares that `splits` produces rows of type `Split`. Each entry in `views` renders the rows. [Declaring a result](../core/results.md#declaring-a-result) states what a rows record accepts.
- **`table({ columns })`** is a [table](../plugins/pack-views.md#table). Each column names a key of `Split`, a header, an alignment, and an optional `format` function that renders the cell. The table measures every row before it writes its first line, so each column is as wide as its widest cell, and it fits the table to the screen.
- **`records({ identifier, fields })`** is a [records list](../plugins/pack-views.md#records): one block of lines per split, with a count at the end. `identifier` names the field that identifies each record, which the view styles apart. A records list is a row view, so it writes each record as the rows arrive.
- **The first view is the default.** `table` comes first, so `pace splits` prints a table unless the operator selects another view.

Both factories are written inside the `views` record, so the row type flows into them from `.rows<Split>()`. A column that names a key `Split` does not have is a compile error, and each `format` function receives that key's own type, such as a `number` for `elapsed`. [Row views](../core/results.md#row-views) states how the type flows. The cell functions `distanceCell` and `durationCell` come from `src/views.ts`. A `format` function returns marked text that you own, and the view writes it without escaping it. These cells interpolate numbers and `pace`'s own unit, never text an operator typed, so nothing in them needs [`style.escape`](../core/styles.md#strings-and-composition).

The action emits the splits as one array:

<!-- example: ../../examples/guide/src/04-results-and-views/actions/splits.ts -->
```ts
import type { ActionHandler } from '@loomcli/core';

import type { splits } from '../commands/splits.js';
import { splitRun, unitLength } from '../pace.js';

export const listSplits: ActionHandler<typeof splits> = ({ args, options, out }) => {
  const { distance: metres, time: seconds } = args;
  const { negative, unit } = options;
  // With no --every, each split is one unit long.
  const every = options.every ?? unitLength(unit);
  return out.results(splitRun({ every, metres, negative, seconds, unit }));
};
```

The loop of `out.print` calls and its `await` are gone, and so is `formatSplit` in `src/pace.ts`. Under `rows`, `out.results` accepts any iterable or async iterable, an array included, so the action does not decide whether its consumer wants every row at once or one at a time. [Emitting a result](../core/results.md#emitting-a-result) states how core feeds each view shape.

`pace splits` now prints the default view:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/splits-table.txt -->
```console
$ pace splits 5k 25:00
SPLIT  DISTANCE  TIME  ELAPSED
    1      1 km  5:00     5:00
    2      2 km  5:00    10:00
    3      3 km  5:00    15:00
    4      4 km  5:00    20:00
    5      5 km  5:00    25:00
```

## Let the operator choose a format

`splits` declares a records view, but nothing yet lets an operator select it. The [formatter](../plugins/format.md), `format()` from `@loomcli/plugins/format`, adds that choice. Install it beside help and version:

<!-- example: ../../examples/guide/src/04-results-and-views/application.ts -->
```ts
import { Application } from '@loomcli/core';
import type { EnvironmentOf } from '@loomcli/core';
import { format } from '@loomcli/plugins/format';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';
import { oneOf } from '@loomcli/validators';

import { calc } from './commands/calc.js';
import { convert } from './commands/convert.js';
import { splits } from './commands/splits.js';

const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  plugins: [help(), version(), format()],
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

The formatter puts a `--format` option on every Command that declares a result, and adds two views, `json` and `jsonl`, to every views record that does not already have them. `--format` selects a view by its name. It is a [control option](../core/commands.md#control-options), because it controls the run rather than feeding the Command's work, and it is absent from the action's types. [Formatter plugin](../plugins/format.md) describes the option, the two views, and the order in which they are added.

`--format records` selects the records view:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/splits-records.txt -->
```console
$ pace splits half 1:45:00 --every 5k --format records
split     1
distance  5 km
time      24:53
elapsed   24:53

split     2
distance  10 km
time      24:53
elapsed   49:46

split     3
distance  15 km
time      24:53
elapsed   1:14:39

split     4
distance  20 km
time      24:53
elapsed   1:39:32

split     5
distance  21.1 km
time      5:28
elapsed   1:45:00

5 records
```

`--format json` selects the formatter's `json` view, which writes the same rows as one JSON array:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/splits-json.txt -->
```console
$ pace splits 3k 15:00 --format json
[
  {
    "distance": 1,
    "elapsed": 300,
    "split": 1,
    "time": 300,
    "unit": "km"
  },
  {
    "distance": 2,
    "elapsed": 600,
    "split": 2,
    "time": 300,
    "unit": "km"
  },
  {
    "distance": 3,
    "elapsed": 900,
    "split": 3,
    "time": 300,
    "unit": "km"
  }
]
```

The JSON holds the values the action emitted, not the text the table drew: `elapsed` is a number of seconds a script can add up, not `5:00`. `--format jsonl` writes one JSON object per line, which suits a tool that reads a line at a time:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/splits-jsonl.txt -->
```console
$ pace splits 3k 15:00 --format jsonl
{"distance":1,"elapsed":300,"split":1,"time":300,"unit":"km"}
{"distance":2,"elapsed":600,"split":2,"time":300,"unit":"km"}
{"distance":3,"elapsed":900,"split":3,"time":300,"unit":"km"}
```

`calc` declares a result too, so it takes `--format` as well. Under `result`, the `json` view receives the one value:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/calc-json.txt -->
```console
$ pace calc 10k 50:00 --format json
{
  "seconds": 300,
  "unit": "km"
}
```

The `json` and `jsonl` views declare the media types `application/json` and `application/jsonl`, and the result publishes them by view name. That is how an agent learns which view to read without guessing from the name, and chapter 7 shows it. To publish a different shape as JSON, a views record can name its own `json: json({ map })`, which the formatter keeps, as [Formatter plugin](../plugins/format.md) describes.

The help page lists `--format` with every view name it accepts and the default:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/splits-help.txt -->
```console
$ pace splits --help
pace splits · List the time of each split of a run.

USAGE
  pace splits <distance> <time> [options]

ARGUMENTS
  distance  How far the run goes, such as 10k, 5mi, half, or marathon.
  time      The time to finish in, as mm:ss or h:mm:ss.

OPTIONS
  -e, --every <every>    How long each split is, such as 1k, 1mi, or 400m. Defaults to one unit.
  -n, --negative         Run the second half faster than the first.
      --format <format>  Select the output format, table by default. One of: table, records, json, jsonl.

GLOBAL OPTIONS
  -u, --unit <unit>  The unit to give a pace in. One of: km, mi.  (default: km)
  -h, --help         Show this help.
  -V, --version      Print the version.
```

A name that is not in the record never reaches the action. The formatter's validator rejects it, and Loom reports the names it accepts and exits with status 2, the usage-error status. The report is text, because the default view, the table, declares no media type:

<!-- transcript: ../../examples/guide/transcripts/04-results-and-views/unknown-format.exit-2.txt -->
```console
$ pace splits 5k 25:00 --format yaml
pace: Option "--format": Supply one of table, records, json, jsonl.
Run "pace splits --help" to see the usage.
```

## Next

Every mistake `pace` reports so far is one its validators find before an action runs. In [Failures](failures.md), `pace`'s actions report failures of their own, with exit codes and messages that tell the operator what to do instead.
