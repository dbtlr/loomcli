---
description: The map of @loomcli/core's source modules. Which folder under packages/core/src holds each concept, and the conventions that place a new file.
---

# Core source modules

`packages/core/src` groups core's source by concept. Each folder is one module, and the modules follow the sections of the [core reference](../core/README.md). This page tells a maintainer where a concept lives and where a new file goes. The modules do not form layers: a module imports from any other module it needs.

## Modules

| Module | What it holds |
| --- | --- |
| `application/` | The `Application` declaration, `run()`, `check()`, and `inspect()`, and the type-level registration that publishes an application's globals and styles. |
| `commands/` | The Command tree, its declaration rules, and the globals table that global options share. |
| `inputs/` | Options, arguments, option groups, bindings, input sources, Standard Schema validation, and content inputs. |
| `marks/` | The run-wide marks that one global option carries: color, verbosity, interaction, and background. |
| `invocation/` | One run from argv to the action: parsing, lowering an invocation by name, `invoke()`, and the middleware chain. |
| `inspection/` | The built Command graph that projections read, and locating a word in an unfinished invocation. |
| `plugins/` | The plugin contract: plugins, extensions, providers, environment preparation, and the graph and failure hooks. |
| `failures/` | Failure classes, exit codes, the plain-data failure form, failure encoders, and translators. |
| `diagnostics/` | Developer Diagnostics: diagnostic rules, defects, declaration facts, rule identities, and how a development build prints them. |
| `output/` | Lanes, views, live regions, progress events, sequences, and logging. |
| `style/` | Marked strings and their wire format, measuring, wrapping, layout, themes, the rendering policy, and the generated glyph and Unicode tables. |
| `host/` | The process handle, the host a run reads, child programs, interrupt keys, and the terminal background query. |
| `signals/` | Signal lanes, cancellation, and shutdown. |
| `shipping/` | Release facts, the installation record, and the application's directories. |
| `support/` | Small helpers with no concept of their own: plain-data checks, control-character escaping, thenables, handed promises, and bounded file reads. |

## Conventions

- `index.ts` is the only barrel and the whole public surface. A module folder has no index file, and an internal import names the file it reads.
- A module's `types.ts` holds the shared public types of its concept: the types that no single file's code owns. A type that belongs with one file's code, such as the registration types in `application/environment.ts`, stays in that file. A type lives in the module of the concept it describes, even when other modules import it.
- A rule family sits in its module's `rules.ts`, apart from the code that raises it, so a rule can be imported without loading that code: the Command family in `commands/rules.ts`, the input family in `inputs/rules.ts`, and the plugin family in `plugins/rules.ts`. `diagnostics/rules.ts` holds core's run-time defects and the faults of failure codes and rule identities. `inputs/content-rules.ts` keeps the content rule apart from the input family, whose test pins `inputs/rules.ts` to exactly that family. A rule that one file alone raises, such as a mark's rule or a shutdown budget's, is declared beside the code that raises it.
- `host/process-handle.ts` is the one file that reads the global `process`, asks `node:os` for the user's folders, and starts real children. Lint allows those calls only there.
- `host/types.ts` carries core's `/// <reference types="node" preserve="true" />` directive. The `preserve` attribute keeps the directive in the emitted declarations, so a consumer's type check of the published package finds the Node globals.
- A new file goes in the module of the concept it serves. It goes in `support/` only when it serves no single concept.
