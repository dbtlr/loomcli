---
description: "Guide chapter 5. Declare a failure class with its own exit code and failure code, translate a domain error into it, end a run with out.fatal, override the defect view, and write messages an operator can act on."
---

# Failures

In this chapter `pace` learns to report its own failures. At the end, `pace splits 5k 25:00 --every 10k` says that the split is longer than the run, tells the operator what to supply instead, and exits with status 64, and with `--format json` it reports the same failure as one line of JSON that a script can branch on.

So far, every mistake `pace` reports is one that a validator finds before an action runs. This chapter adds the failures an action finds: a split longer than the run, which gets a class of its own, and a run with too many splits, which a single `out.fatal` call reports. The [Failures](../core/failures.md) reference states every rule this chapter uses, and the [glossary](../glossary.md#failures) defines its terms.

## Let the domain module throw

A split can be longer than the run only when both are known, so no validator of a single input can reject it. The check belongs to the arithmetic, and `src/pace.ts` still knows nothing about Loom, so it throws an error of its own. Add the error class to `src/pace.ts`:

<!-- example: ../../examples/guide/src/05-failures/pace.ts#domain-error -->
```ts
/** A split longer than the run it splits. */
export class SplitLongerThanRunError extends RangeError {
  /** The split's length, in metres. */
  readonly every: number;
  /** The run's length, in metres. */
  readonly metres: number;
  readonly unit: Unit;

  constructor({ every, metres, unit }: SplitPlan) {
    super('The split is longer than the run.');
    this.name = 'SplitLongerThanRunError';
    this.every = every;
    this.metres = metres;
    this.unit = unit;
  }
}
```

The class extends the platform's `RangeError` and carries the facts a message needs: the split's length, the run's length, and the unit. `splitRun` throws it before it works out any split:

<!-- example: ../../examples/guide/src/05-failures/pace.ts#split-run -->
```ts
/** The splits of a run, each with its own time and the time elapsed at its end. */
export function splitRun(plan: SplitPlan): Split[] {
  if (plan.every > plan.metres) {
    throw new SplitLongerThanRunError(plan);
  }
  const ends = splitEnds(plan.metres, plan.every);
  return ends.map((end, index) => {
    const start = ends[index - 1] ?? 0;
    return {
      distance: roundTo(end / metresPer[plan.unit], 2),
      elapsed: Math.round(elapsedAt(plan, end)),
      split: index + 1,
      time: Math.round(elapsedAt(plan, end) - elapsedAt(plan, start)),
      unit: plan.unit,
    };
  });
}
```

The error's own message is for whoever reads the domain module, not for the operator. The next two steps give the operator a message of `pace`'s own.

## Declare a failure class

Every failure Loom reports is an instance of a public class, and an application declares its own by extending `FatalError`, the class `out.fatal` throws. Create `src/failures.ts` with the class, importing `EX_USAGE`, `FatalError`, and `translate` from `@loomcli/core`:

<!-- example: ../../examples/guide/src/05-failures/failures.ts#failure-class -->
```ts
/**
 * A split longer than the run. The operator chose the split with --every, so the failure exits
 * with `EX_USAGE`, and a script branches on its failure code, `split-too-long`.
 */
export class SplitTooLongError extends FatalError {
  static override readonly code = 'split-too-long';
  static override readonly exitCode = EX_USAGE;

  constructor(split: string, run: string, options?: ErrorOptions) {
    super(
      `A split of ${split} is longer than the ${run} run. Supply a shorter --every, or run pace calc for the pace of the whole run.`,
      options,
    );
    this.name = 'SplitTooLongError';
  }
}
```

Read the class from the top:

- **`static override readonly code`** is the failure code, `split-too-long`. A script or an agent branches on it, because many failures share one exit code. A code is lowercase words joined by hyphens, and a class whose code breaks that grammar raises a declaration error when one of its failures is constructed. [Failure codes](../core/failures.md#failure-codes) states the grammar.
- **`static override readonly exitCode`** is the exit code, `EX_USAGE`, which is 64. The operator chose the split with `--every`, so the invocation is wrong. Loom exports the `sysexits.h` names with their literal types, and the type accepts a code from 1 through 125, so a reserved code such as 0 or 130 is a compile error. [Declared exit codes](../core/failures.md#declared-exit-codes) lists the names and the range.
- **The constructor** writes the operator's sentence from two distances and passes the platform's `ErrorOptions` on to `FatalError`, so the failure can keep the error it replaces as its `cause`.

Both codes live on the class, so every `SplitTooLongError` exits 64 and reads `split-too-long`, and nothing sets a code per throw.

## Translate the domain error

`splitRun` throws a `SplitLongerThanRunError`, and an action could catch it and throw a `SplitTooLongError` in its place. A translator does that once for the whole application, so no action repeats the catch. Add it below the class:

<!-- example: ../../examples/guide/src/05-failures/failures.ts#translator -->
```ts
/** The domain module throws its own error, so no action catches it to report it. */
export const splitTooLong = translate(
  SplitLongerThanRunError,
  (error) =>
    new SplitTooLongError(
      formatDistance(error.every, error.unit),
      formatDistance(error.metres, error.unit),
      {
        cause: error,
      },
    ),
);
```

`translate` pairs an error class with a function. The function receives the thrown error, typed from the class, and returns a failure, or `undefined` to pass the throw on. It writes both distances in the run's unit with `formatDistance`, a helper `src/pace.ts` gains in this chapter, and passes the domain error as `cause`, because Loom never sets `cause` for you. The application lists its translators under `translators`, as the next sections show.

Loom offers a throw from an action, a middleware, or an input source to the translators at the point it would otherwise report it as a defect. A failure class is never offered, so a `SplitTooLongError` an action throws itself reports as it is. The translated failure reports as if the action had thrown it: it exits with its class's code and renders through its class's view. [Translators](../core/failures.md#translators) states the order in which Loom consults them.

## End a run with `out.fatal`

Not every failure needs a class. `pace splits` lists at most 1000 splits, a limit that belongs to that one action, so the action reports it with `out.fatal` in `src/actions/splits.ts`:

<!-- example: ../../examples/guide/src/05-failures/actions/splits.ts -->
```ts
import type { ActionHandler } from '@loomcli/core';

import type { splits } from '../commands/splits.js';
import { splitCount, splitRun, unitLength } from '../pace.js';

/** The most splits pace lists for one run. */
const mostSplits = 1000;

export const listSplits: ActionHandler<typeof splits> = ({ args, options, out }) => {
  const { distance: metres, time: seconds } = args;
  const { negative, unit } = options;
  // With no --every, each split is one unit long.
  const every = options.every ?? unitLength(unit);
  const count = splitCount(metres, every);
  if (count > mostSplits) {
    out.fatal(
      `The run makes ${String(count)} splits, and pace lists at most ${String(mostSplits)}. Supply a longer --every, such as 1k.`,
    );
  }
  return out.results(splitRun({ every, metres, negative, seconds, unit }));
};
```

`out.fatal` throws a `FatalError` with the message, so the run exits with status 1 and its failure code reads `fatal`. Its return type is `never`, so the code after the `if` block runs only when the count fits. `splitCount` is the count `splitRun` already used, moved into its own function so that the action and the domain module agree on it. [Output](../core/output.md) describes `out.fatal`.

Declare a class when a script or a view needs to tell the failure apart, by its exit code, its failure code, or its facts. Use `out.fatal` for a failure that one action reports once and that needs neither.

## Override the defect view

Loom renders each failure through the failure view of its class. Core's default text is each class's default view, so an application replaces it with `override`, keyed by the class. [Failure views](../core/failure-views.md#failure-views) states how Loom resolves a failure's view.

`pace` keeps core's text for `FatalError`. That text is the message as written, with no prefix, as chapter 1's `Cannot read the distance` message showed, while a usage error opens with the application name. [Failure classes](../core/failures.md#failure-classes) states which classes take the prefix. Each of `pace`'s messages is a whole sentence for the operator, and a plugin that ends a run with a failure of its own writes its own wording: the self-update plugin in [chapter 8](shipping.md) opens its refusal with the application name. A view that added `pace: ` to every `FatalError` would print the name twice under that refusal, so `pace` adds nothing.

A defect is different. A defect is a failure only the author can fix, such as an exception no translator answered, which core reports as an `InternalError`. Core's message for it gives the operator no next step, and `pace` has one: its issue tracker. Override the defect view in `src/views.ts`:

<!-- example: ../../examples/guide/src/05-failures/views.ts#defect-view -->
```ts
/** A defect in a distributed build: the generic message, and where to report it. */
export const defectView: FailureView<InternalError> = {
  render: (_failure, { application, hints }) =>
    lines([
      `${application}: Something went wrong. Report it at https://github.com/acme/pace/issues.`,
      ...hints,
    ]),
};
```

A failure view receives the failure and the [failure view context](../core/failure-views.md#failure-view-context), which carries the application name and the hint lines that plugins added. It returns the whole text, its trailing newline included, and the `lines` helper earlier in the file ends each line with one. A view that leaves `hints` out prints none, so `defectView` prints them after its own line.

What a defect shows depends on the build. In a distributed build, the build `loom build` makes, the operator sees one generic message, `pace: Something went wrong.`, with no reason, class name, or stack. The operator cannot change the code, so the error's reason gives them no step to take, and its text can carry a path or a value they never supplied. With `defectView` installed, that line also says where to report the defect. In a development build, such as `bun src/main.ts`, Loom writes the defect's Developer Diagnostic instead, the error, the line that threw it, and how to fix it, ahead of every override, so no view hides a fault from you. [Development builds](../core/release-facts.md#development-builds) states which build a run is and what each one prints, and chapter 8 makes a distributed build.

Install the view and the translator in `src/application.ts`, importing `InternalError` and `override` from `@loomcli/core`:

<!-- example: ../../examples/guide/src/05-failures/application.ts#application -->
```ts
const configured = new Application('pace', {
  description: 'Work out running paces, splits, and conversions.',
  plugins: [help(), version(), format()],
  translators: [splitTooLong],
  views: [override(InternalError, defectView)],
}).globalOption('unit', {
  default: 'km',
  description: 'The unit to give a pace in.',
  env: 'PACE_UNIT',
  short: 'u',
  type: 'string',
  validate: oneOf(['km', 'mi']),
});
```

`override(InternalError, defectView)` keys the view by the class, so TypeScript checks `defectView` against an `InternalError`.

## Run it

A split longer than the run now reaches the translator, renders through core's view of `FatalError`, and exits with the class's code:

<!-- transcript: ../../examples/guide/transcripts/05-failures/split-too-long.exit-64.txt -->
```console
$ pace splits 5k 25:00 --every 10k
A split of 10 km is longer than the 5 km run. Supply a shorter --every, or run pace calc for the pace of the whole run.
```

A run with too many splits ends at the action's `out.fatal` and exits with status 1:

<!-- transcript: ../../examples/guide/transcripts/05-failures/too-many-splits.exit-1.txt -->
```console
$ pace splits marathon 3:30:00 --every 1m
The run makes 42195 splits, and pace lists at most 1000. Supply a longer --every, such as 1k.
```

A time that the validator rejects never reaches an action. Loom reports it as its own usage error with status 2, and the help plugin adds a hint line under it:

<!-- transcript: ../../examples/guide/transcripts/05-failures/bad-time.exit-2.txt -->
```console
$ pace calc 10k 50
pace: Argument "time": Expected a time above zero as mm:ss or h:mm:ss, such as 25:30.
Run "pace calc --help" to see the usage.
```

The two usage failures exit with different statuses on purpose. Loom raises an input it rejects as 2 and never 64, and `EX_USAGE` is left for an application's own usage failure, so a script tells Loom's report from `pace`'s by the status alone. The help plugin's hint follows a usage error alone, so neither of `pace`'s failures gains it. [Help's failure hint](../plugins/suggestions.md#helps-failure-hint) states when it applies.

## Report a failure to a script

With `--format json`, a failed run writes its failure in the same format a successful one writes its result:

<!-- transcript: ../../examples/guide/transcripts/05-failures/split-too-long-json.exit-64.txt -->
```console
$ pace splits 5k 25:00 --every 10k --format json
{"error":{"code":"split-too-long","exitCode":64,"message":"A split of 10 km is longer than the 5 km run. Supply a shorter --every, or run pace calc for the pace of the whole run.","hints":[]}}
```

The line is the [failure form](../core/failures.md#the-failure-form), the failure as plain data, which the formatter writes to stderr through its failure encoder. It holds the class's failure code, its exit code, the message as plain text, and the hint lines. The encoder writes in place of the failure view, so the line carries the failure's facts and no view's wording. A script reads `error.code` to tell a split too long from any other failure. [Failure encoders](../core/failure-views.md#failure-encoders) states when an encoder answers. In a distributed build, a defect's form reads the code `internal` and the message `Something went wrong.`, so a script learns no more about a defect than an operator does.

## The path every failure takes

No action in `pace` catches an error. A failure takes one path: it leaves the action, a foreign throw is offered to the translators, each plugin's `onFailure` hook adds its hint lines, the failure view or a failure encoder writes the report, and the run exits with the failure's code. [The ordinary failure path](../core/failures.md#the-ordinary-failure-path) states each step.

An author's catch is final. If `listSplits` caught the `SplitLongerThanRunError` and carried on, the run's outcome would be whatever the action did next: Loom neither records a caught failure to fail the run later nor turns a failure the action lets propagate into a success. `pace` lets the error propagate, because the run should fail.

## Write messages an operator can act on

Loom cannot check a message an application writes, so the quality of `pace`'s messages is yours. The [failure message voice](../core/failures.md#failure-message-voice) is the rule every message Loom ships follows, and `pace`'s messages follow its shape. This is how the voice reads for an application:

- **Say what went wrong, then what to do instead.** `A split of 10 km is longer than the 5 km run.` names the problem, and `Supply a shorter --every, or run pace calc for the pace of the whole run.` gives two ways forward. The too-many-splits message suggests a value, `1k`.
- **Name your own Commands and options.** `pace` knows its own Commands, so its messages name `--every` and `pace calc`. A pointer that depends on an installed plugin, such as the help page, comes from the plugin as a hint line, as `Run "pace calc --help" to see the usage.` does under the bad time.
- **Repeat a value only when you know it is not a secret.** Loom's own messages never repeat an input's value, because Loom cannot know which values are secret. An application owns its inputs and can know. A distance is never a secret, so `pace` repeats both distances, and the split count. For an input that can hold a secret, such as a token, describe what the input accepts instead.
- **Decide which foreign text to quote.** Loom never quotes text it did not write, such as an engine's reason or a thrown error's message. That rule binds Loom and not an application, which owns its domain. `pace`'s translator writes its own sentence from the error's facts and keeps the `RangeError` as `cause` instead of quoting it. An application that reads files can keep a runtime's reason in a `Cannot read` message, because the reason points at what the operator must fix.
- **Give a defect a next step when you have one.** The generic defect message is the one operator message with no next step, because Loom cannot name one honestly. `pace` has one, its issue tracker, so `defectView` adds it.

## Next

`pace` installs three of Loom's plugins and passes each one nothing. In [Plugins](plugins.md), it installs more of them, reads its default unit from a configuration file, and gains a plugin of its own.
