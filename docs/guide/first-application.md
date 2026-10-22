---
description: "Guide chapter 1. Scaffold an application with loom init, replace its action with one that reads two arguments, and install help and version."
---

# Your first application

In this chapter you scaffold a new application with `loom init` and turn it into `pace`, a command that works out the pace of a run from its distance and time. At the end, `pace 10k 50:00` prints `5:00 /km`, and `pace --help` prints a help page that Loom builds from your declarations.

The guide builds `pace` one chapter at a time. Each chapter's code is a complete application under [`examples/guide/src/`](../../examples/guide/src), so you can compare one chapter's files with the next.

## Scaffold the application

You need [pnpm](https://pnpm.io), which the guide installs packages with, and [Bun](https://bun.sh), which [`loom build`](../toolchain/build.md) bundles with. Create a directory and run `loom init` in it:

```sh
mkdir pace && cd pace
bunx @loomcli/loom init
pnpm install
pnpm check
```

`loom init` asks which linter and which test runner the application uses. Accept the defaults, oxlint and Bun, which the rest of the guide uses.

Among other files, `loom init` writes a `package.json`, a strict `tsconfig.json`, the lint configuration, and three files under `src/`:

- `src/application.ts` declares the Application, with a description and one action that prints a line.
- `src/main.ts` imports the Application and runs it.
- `src/application.test.ts` checks that the whole application assembles. Chapter 8 returns to it.

`pnpm check` runs the type checker, the linter, and that test. The [loom init reference](../toolchain/init.md) lists every file and key it writes.

The scaffold depends on `@loomcli/core` alone. `pace` also installs two plugins, so add the first-party plugin package:

```sh
pnpm add @loomcli/plugins
```

## Declare the application

Replace `src/application.ts` with this declaration:

<!-- example: ../../examples/guide/src/01-first-application/application.ts -->
```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { version } from '@loomcli/plugins/version';

import { formatPace, paceOf, parseDistance, parseTime } from './pace.js';

export const pace = new Application('pace', {
  description: 'Work out the pace of a run from its distance and time.',
  plugins: [help(), version()],
})
  .argument('distance', {
    description: 'How far you ran, such as 10k, 5mi, 400m, half, or marathon.',
    required: true,
  })
  .argument('time', {
    description: 'How long the run took, as mm:ss or h:mm:ss.',
    required: true,
  })
  .action(({ args, out, style }) => {
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
    return out.print(formatPace(paceOf(metres, seconds, 'km')));
  });
```

The arithmetic lives in [`src/pace.ts`](../../examples/guide/src/01-first-application/pace.ts), a module that knows nothing about Loom. Copy it into your project. It reads a distance as metres and a time as seconds, and returns `undefined` for text it cannot read.

Read the declaration from the top:

- **`new Application('pace', options)`** names the application. The name is the command an operator types at the shell prompt. The `description` appears on the help page, and later chapters show it to agents too.
- **`plugins`** installs the help and version plugins. [Core installs no plugin of its own](../core/plugin-contract.md), so an application has a `--help` option only when it installs the [help plugin](../plugins/help.md), and a `--version` option only when it installs the [version plugin](../plugins/version.md).
- **`.argument()`** declares a positional input. The two arguments bind the first two plain words on the command line, in the order you declare them, and an option may sit before, between, or after them, as [Application declarations](../core/application.md) describes. Each one is `required`, so its value in the action is a `string`, not `string | undefined`.
- **`.action()`** registers the code that runs when an operator invokes the application. It receives the parsed arguments in `args`, `out`, which writes output, and `style`, which marks and escapes text.

Each call returns a new declaration and leaves the value it was called on unchanged, so keep the value the last call returns. That is why the whole declaration is one chain assigned to `pace`. The calls also follow an order that the types enforce: after `.action()`, the value offers no `.argument()`, so a misplaced call is a compile error rather than a surprise at run time. [Application declarations](../core/application.md) lists which call removes which.

## Write output and report a mistake

The action writes its answer with `out.print`, which writes to stdout and adds a newline. [Output](../core/output.md) lists the other methods, such as `out.info` and `out.warn`, which write to stderr.

When the operator types a distance or a time that `pace` cannot read, the action calls `out.fatal` with a message. `out.fatal` throws a `FatalError`, and when nothing catches it, Loom prints the message and exits 1. Its return type is `never`, so `parseDistance(args.distance) ?? out.fatal(...)` has the type `number`, and the rest of the action reads a number.

Each message says what went wrong and what to do instead. A message is marked text that can carry styles, so the action quotes the operator's text through `style.escape`, which prints it as typed even where it looks like Loom's style markup. [Styles and rendering policy](../core/styles.md) describes marked text. Chapter 5 covers failures in full, and chapter 3 replaces these checks with validators that run before the action.

## Run it

While you work, run the entry with Bun, which runs TypeScript directly:

```sh
bun src/main.ts 10k 50:00
```

The guide writes the command as `pace`, as an operator types it once the application is installed. Chapter 8 builds and installs it. Until then, a shell alias lets you type the same commands while you develop:

```sh
alias pace='bun src/main.ts'
```

<!-- transcript: ../../examples/guide/transcripts/01-first-application/calc.txt -->
```console
$ pace 10k 50:00
5:00 /km
```

A distance that `pace` cannot read ends with the action's message and exits 1:

<!-- transcript: ../../examples/guide/transcripts/01-first-application/bad-distance.exit-1.txt -->
```console
$ pace 10x 50:00
Cannot read the distance "10x". Write one such as 10k, 5mi, 400m, half, or marathon.
```

A missing argument never reaches the action. Loom reports it and exits 2, the status of a [usage error](../core/failures.md#failure-classes). The last line is a hint from the help plugin, which points at the help page:

<!-- transcript: ../../examples/guide/transcripts/01-first-application/missing-time.exit-2.txt -->
```console
$ pace 10k
pace: Argument "time" requires a value. Supply a value for "time".
Run "pace --help" to see the usage.
```

The help plugin builds the help page from the declaration. Each description you wrote appears beside the member it describes:

<!-- transcript: ../../examples/guide/transcripts/01-first-application/help.txt -->
```console
$ pace --help
pace · Work out the pace of a run from its distance and time.

USAGE
  pace <distance> <time> [options]

ARGUMENTS
  distance  How far you ran, such as 10k, 5mi, 400m, half, or marathon.
  time      How long the run took, as mm:ss or h:mm:ss.

OPTIONS
  -h, --help     Show this help.
  -V, --version  Print the version.
```

The version plugin prints the version the Application declares. `pace` declares none yet, so it reads [`0.0.0`](../plugins/version.md), which means unversioned. Chapter 8 reads the version from `package.json`.

<!-- transcript: ../../examples/guide/transcripts/01-first-application/version.txt -->
```console
$ pace --version
pace v0.0.0
```

## Next

`pace` does one job from its root. In [Commands and options](commands-and-options.md), it grows into a group of Commands that work out a pace, list splits, and convert between kilometres and miles.
