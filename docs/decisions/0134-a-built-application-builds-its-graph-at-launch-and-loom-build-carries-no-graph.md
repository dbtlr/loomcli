---
type: adr
title: ADR-0134 - A built application builds its graph at launch, and loom build carries no graph
description: A built application runs graph build when its process starts, from the declarations its module evaluates, exactly as an unbuilt run does. loom build bundles the application and carries its release facts and skills folder, and it carries no Command graph into the artifact. Launch cost may be cut only by work that changes no contract. Carrying a graph built during loom build, and building only the routed path at launch, were measured and rejected.
status: accepted
created: 2026-11-02
modified: 2026-11-02
---

# ADR-0134 - A built application builds its graph at launch, and loom build carries no graph

## Context

A command-line application starts a fresh process for every invocation, so a graph one process builds cannot serve the next. When the process starts, the application module evaluates and its authoring calls apply the declaration rules they can judge. Each `run()` then runs graph build, with its lifecycle hooks at every depth, and validates every declared default before any token is read (ADR-0010, ADR-0028, ADR-0060, ADR-0093). That work grows with the number of Commands and options.

`loom build` already loads the application module in a process of its own to read the skills folder (ADR-0133), so it could also run graph build and carry the result into the artifact. A Command graph holds closures, which data cannot carry: actions, validators such as a configured `number()`, the per-Command `--format` validator the format plugin's `onCommandAttach` hook makes, views, translators, and plugin hooks. Two designs that keep them were built against core at 0.17.0 and compared with the unchanged core and with core after removing redundant work.

The comparison started each variant in fresh processes on Node and Bun, in 41 interleaved rounds on one host. Outputs, errors, and exit codes were compared across a 50-case matrix and an application of 3 to 203 Commands, and counters recorded the declaration rules, Command builds, hook calls, default validations, and schema conversions each launch ran. Median launch times, in milliseconds, for one routed Command:

| Variant | 53 Commands, Node | 203 Commands, Node | 203 Commands, Bun | `examples/jsonkit` (29 Commands), Node |
| --- | --- | --- | --- | --- |
| Unchanged core | 162 | 248 | 200 | 137 |
| Redundant declaration and graph-build work removed | 144 | 215 | 157 | 129 |
| Only the routed path built at launch, on top of the row above | 135 | 181 | 123 | 129 |
| Graph built during `loom build` and carried into the artifact | 166 | 256 | 143 | not built |

A process that only imports core, the validators, the first-party plugins, and `zod` takes about 75 ms on Node and 47 ms on Bun. Profiling `examples/jsonkit` put its graph build at about 8 ms of the 137 and host capture's time-zone lookup at 11 to 13 ms. The timings come from a shared host and illustrate the shape; the counters and the parity matrix are the evidence.

## Decision

- **Graph build runs at launch.** A built application, a development or distributed bundle or a compiled binary, evaluates its application module and runs graph build when its process starts, as an unbuilt run and a test do. ADR-0010's promise holds unchanged for every form: graph build applies the rules no earlier moment can judge, at every depth, before any invocation token is read, and an authoring call or an attach keeps the rules it judges (ADR-0093). `inspect()` builds from the declarations.
- **`loom build` carries no graph.** It bundles the application and carries its release facts and its skills folder (ADR-0133). It carries no Command graph, part of one, or a table that binds closures to one into the artifact. A check `loom build` might run over the declarations, which leaves nothing in the artifact, is outside this record.
- **Launch cost is cut only by work that changes no contract.** Work that repeats or that no fault reads, such as rebuilding an option list's spelling table on each `option()` call, building an option's call site before a fault needs it, or rebuilding the globals table on each authoring call, may be removed. Every declaration error keeps its moment and content, hooks keep their timing, and defaults keep their validation. The cost around graph build, such as what core and plugins evaluate at import and what host capture reads, is cut under the same rule.

## Considered options

- **Graph build during `loom build`, carried into the artifact.** Rejected. At launch the application module still evaluated so its closures existed, the authoring calls only recorded their arguments, each closure bound to the carried graph by its Command path and slot, and a hook-made executable carried a recipe (a module, an export, and data arguments) that rebuilt it. Launch ran no declaration rule, Command build, lifecycle hook, default validation, or schema conversion, and the parity matrix matched on both runtimes. Reading and decoding the carried graph took back most of what it saved: at 203 Commands it launched 8 ms slower than unchanged core on Node and 57 ms faster on Bun, it was slower than the routed-path variant at every size on both runtimes, and small applications launched slower than unchanged core. It also broke three promises. A declaration error no longer threw at the authoring call. An `onCommandAttach` hook whose contribution depended on launch-time state diverged from the build with nothing to detect it. A default whose validator reads the host, such as a `path()` resolved against the working directory, carried the build machine's value. At about 12 KB per Command, a carried graph also outgrows a `--define` argument at about ten Commands, because the operating system caps one argument's length (128 KiB on Linux), so a larger one needs a file beside the bundle.
- **A graph of plain data, such as the frozen `inspect()` graph.** Rejected. It carries no closures, so the artifact would have to import the application again to recover them, which is graph build by another name.
- **Building only the routed path at launch.** Rejected for now. Graph build covered the root, the globals, and the routed path, so its Command builds, hook calls, and default validations stayed constant as the application grew, and it was the fastest variant at 53 Commands and above. It gained nothing on Node in `examples/jsonkit`. The measured variant was incomplete: `onGraphBuilt`, every declared default, and the converter check would have to move to an asynchronous whole-graph check that `loom build` runs, which neither `check()` nor `loom build` provides. It would supersede ADR-0060's `onGraphBuilt` on every `run()`, `inspect()`, and `app.invoke()`, ADR-0028's attach hook on every Command at every build, ADR-0010's rules before any token for the Commands an invocation does not route to, and the moment every default validates, and a rejecting `onGraphBuilt` hook would no longer fail `run()`, `--help`, or `--manifest`. A record that supersedes this one may take it up with measurements from an application whose graph build is most of its launch time.
- **Rewriting the application's source during the bundle to lift closures out of the authoring calls.** Rejected. Closures capture module scope, so a transform that moves them changes what they read.

## Consequences

- Every artifact form launches through the same graph build as a source run, so a test, `inspect()`, and a built application agree without a second path to keep in step.
- The lifecycle hook reference stays as it is: `onCommandAttach` and `onGraphBuilt` run at every graph build, including a built application's launch.
- A closure core keeps in a built Command needs no rule for rebuilding it in another process, which a carried graph required of every one.

## Status

Accepted on merge. It keeps the behavior every form already has and binds the design of launch work from the merge rather than from a release cut.

## Changelog

- 2026-11-02: Recorded after two measured comparisons (LM-328). It supersedes no record.
