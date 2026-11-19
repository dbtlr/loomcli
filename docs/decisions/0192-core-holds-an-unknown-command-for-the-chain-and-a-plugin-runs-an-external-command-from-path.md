---
type: adr
title: ADR-0192 - Core holds an unknown command for the chain, and a plugin runs an external command from PATH
description: Routing still finds an unknown command where it does today, but core holds UnknownCommandError and raises it at the dispatch boundary, in run() and invoke() alike, after running only the 'always' middleware. Those middleware read the unknown word and the words after it under a new unknownCommand member of the middleware context, beside invokedBy, so one can take the run over, and a run whose action never dispatched may end with a code a middleware stated. Nothing past the word is parsed or validated, so an application without such a middleware prints and exits as it does today. The first-party externalCommands() plugin uses the seam: when the first word of argv is unknown, it walks the run's PATH for a file named <application>-<word>, starts the file it found, and exits with the child's code. It supersedes in part ADR-0017's and ADR-0055's rule that an unknown command fails before the chain, and narrows ADR-0028, ADR-0032, ADR-0059, ADR-0095, and ADR-0097.
status: proposed
created: 2026-11-19
modified: 2026-11-19
---

# ADR-0192 - Core holds an unknown command for the chain, and a plugin runs an external command from PATH

## Context

Command-line tools that operators extend share one habit: a program named `<tool>-<word>` on `PATH` runs as `<tool> <word>`. git runs `git-foo` for `git foo`, cargo runs `cargo-foo`, kubectl runs `kubectl-foo`, and `gh extension` installs `gh-foo`. clap reports such a word as an external subcommand, and oclif's `command_not_found` hook takes it over. An operator puts a program on `PATH` and the tool gains a word, and the tool's author ships nothing for it.

A Loom application cannot do this, and no plugin can add it. Routing raises `UnknownCommandError` before the middleware chain runs ([`parse.ts`](../../packages/core/src/invocation/parse.ts) for argv and [`lower.ts`](../../packages/core/src/invocation/lower.ts) for a path by name). It is the one fault core does not hold: [ADR-0017](0017-plugins-participate-through-one-middleware-chain-with-declared-activation.md) placed the chain after routing, saying that an unknown command still fails in routing first. [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md) then held every fault except an unknown command, "the one fault raised before the chain". [Commands](../core/commands.md#global-consumption-and-routing) and [Middleware](../core/middleware.md) restate the rule. Middleware is Loom's one mechanism for taking a run over, as help and version do, but it never sees an unknown command.

The owner settled the contract on 2026-11-18 (LM-396):

- Core holds the unknown-command fault and raises it at the dispatch boundary, as it does every other routing fault, in both parse and invoke, so that `app foo` and `invoke(['foo'])` agree.
- Validation stays skipped for an unknown command, so `app nope --bad` reports only the unknown command, and suggestions still read the fault's candidates.
- The middleware context carries the unmatched word and the words after it, so an always-active middleware can take the run over without calling `next()`.
- A first-party plugin runs `<app>-<word>` from `PATH`, with the run's exit code taken from the child's. A declared Command, hidden ones included, always wins.
- External commands do not appear in help, completion, or the manifest.

Three facts shape how the contract is met. Today a middleware's takeover always exits 0, unless it throws. A failure class declares a code from 1 through 125 only ([ADR-0095](0095-the-type-bounds-a-declared-exit-code.md)), and every failure prints a message. So no middleware can end a run with a child's code, such as 3, 127, or 139, without printing a line the child did not write. Second, a middleware cannot tell an argv run from an invocation by name, although a failure view, a configuration source, a provider, and an `onFailure` hook each read `invokedBy`. Third, Node and Bun cannot replace the running process with another program, so the application waits for the child and reports its exit, as `gh` does.

A spawn's error cannot say whether a program exists. On Windows, libuv searches the working directory before `PATH`, so a `notes-sync.exe` in the working folder starts although the contract says `PATH`. `ENOENT` does not prove absence: a program on `PATH` whose `#!` interpreter is missing also reports `ENOENT`. `EACCES` does not prove presence: Node reports `EACCES` for a name that exists nowhere when a directory on `PATH` cannot be searched, and Bun reports `ENOENT` for a file that is not executable. git does not trust a spawn's error either. Its `start_command` resolves a dashed command through `locate_in_PATH` (`run-command.c`) before it forks: that search walks `PATH` itself and takes the first regular file the user can execute, passing over one without the execute bit. With only a non-executable `git-zzprobe` on `PATH`, git 2.56.1 reports `'zzprobe' is not a git command` and exits 1. Its `sane_execvp` also reports `ENOTDIR` as `ENOENT` unconditionally, and `EACCES` as `ENOENT` unless the file exists on `PATH`. So presence is decided by a search of `PATH`, as git's `locate_in_PATH` decides it, not by a spawn's error.

## Decision

### Core holds the unknown command

- **Where it arises is unchanged.** Routing finds an unknown command exactly where it does today. On argv, it is a plain word that names no child or alias of a Command with children that declares no argument, under [ADR-0160](0160-a-command-with-an-action-may-declare-arguments-and-hold-children-and-an-exact-child-name-routes-first.md). By name, it is a path element that no child holds, or an element after a Command with no children. A word that fills an argument, a word after a bare `--`, and a hidden Command's or an alias's name never reach it, so a declared Command always wins.
- **It is held, and raised at the dispatch boundary.** Core builds the same `UnknownCommandError`, with the same `token`, `candidates`, `path`, message, and exit code 2, and holds it until the chain reaches the [dispatch boundary](../core/middleware.md). It ranks ahead of every other fault, as it does today. This holds in `run()` and in `invoke()` alike.
- **Nothing past the word is read.** Routing stops at the unknown word. Core does not parse the routed Command's words, run the [input-source stage](../core/input-sources.md), decide [interaction](../core/interaction.md), or run the validation pass, including the pass that fills a plugin's `ownOptions`. So `app nope --bad` reports only the unknown command and calls no validator. A declared default or implied value still validates before routing, as it does today. Verbosity still settles 0 for a word list that names an unknown command, under [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md).
- **Only `'always'` middleware runs.** [Activation](../core/plugin-contract.md#activation) is evaluated after the input-source stage, from the tiers that supplied each option, and that stage does not run here. So no option activates a middleware on an unknown command. Core runs the middleware declared `'always'`, in installation order, and no other. An option word that routing read before the unknown word activates nothing, so `app --help nope` reports the unknown command as it does today, and never renders the root's help.

### What a middleware reads

- **The unknown command.** The middleware context gains `unknownCommand`. It is `null` on every run except one that holds an unknown command, where it is a frozen `UnknownCommand`:

  ```ts
  interface UnknownCommand {
    readonly word: string; // the word no child holds, as typed
    readonly rest: readonly string[]; // every word after it, unread, in order
  }
  ```

  On argv, `rest` is every word of `host.argv` after `word`, as typed: a bare `--`, option words, and the words after them are included. So `app foo a --b` reads `{ word: 'foo', rest: ['a', '--b'] }`, and `app foo --help` reads `rest: ['--help']`. By name, `word` is the path element no child holds and `rest` is the path elements after it. `args`, `options`, and `passthrough` are named values, not words, and they do not appear in `rest`. Global option words before `word` belong to the application and stay out of `unknownCommand`. Routing has already read them, and no validator has run on them.
- **How the run was invoked.** The middleware context gains `invokedBy: 'argv' | 'name'`, the fact a [failure view](../core/failure-views.md#failure-view-context), a configuration source, a provider opener, and an `onFailure` hook already read. It reads the same on every run, not only one that holds an unknown command.
- **Every other member.** On a run that holds an unknown command, the other members of the context read as follows:
  - `command` is the last Command the partial path reached, which is the root for `app nope`, as an `onFailure` hook's `command` is, and `graph` is the run's frozen graph.
  - `options` is `null`, `ownOptions` and `spellings` are empty frozen records, and `request` is `null`, because core holds a fault and no validator ran. This narrows [ADR-0064](0064-a-failure-class-declares-a-failure-code-and-a-plugin-encodes-the-failure-form-by-media-type.md)'s rule that core validates a plugin's own parsed options under any held fault: the unknown command is the one held fault under which it validates none, so `app --format json nope` writes what it wrote before.
  - `view` reads `null`, as on a Command that declares no result. `mediaType` and `transform` read `undefined` until a middleware assigns one. A bad assignment ranks behind the held fault, so the boundary never reports one here.
  - A failure view's context reads `view` as `undefined` for an unknown command, as it does today, and `mediaType` as a middleware assigned it, as it does under any held fault.
- **Why not on `request`.** `Request` is the routed Command's validated invocation, and it is `null` under every held fault. A middleware already reads a non-null `request` as an invocation that passed validation, as the formatter's `--fields` does. An unknown command is a held fault that reached no Command, so `request` stays `null`, and the word sits beside it on the context.

### Taking the run over

- **A takeover.** A middleware that returns without calling `next()` takes the run over, as it does on any held fault. The unknown command is never raised, and nothing later in the chain runs. A middleware that calls `next()` reaches the boundary through the rest of the chain, and the boundary raises the unknown command: the rejection propagates outward, and a middleware that catches it decides the outcome, under [ADR-0097](0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md).
- **A takeover states its exit code.** The middleware context gains an `exitCode` accessor:

  ```ts
  get exitCode(): ExitCode | undefined;
  set exitCode(code: ExitCode);
  ```

  It reads `undefined` until a middleware assigns a code, and the last assignment before the chain settles wins. Core reads it when the run ends with no failure left, the run not cancelled, and the action never dispatched. That covers both kinds of takeover that `next()` reports as `'taken-over'`: a middleware that returned without calling `next()`, and one whose `next()` rejected with the fault the boundary raised and which caught it and returned. The run then exits with the assigned code, or 0 when none was assigned. A failure, an output failure, and a cancellation keep their codes and their precedence under [Signals, cancellation, and shutdown](../core/signals.md). A run whose action dispatched ignores the assignment, so the action's outcome decides the code.

  The type bounds the code. The setter takes `ExitCode`, every whole number from 0 through 255, and core checks nothing at run time, as [ADR-0095](0095-the-type-bounds-a-declared-exit-code.md) bounds a failure class's code by `FailureExitCode` alone. A value that bypasses the types gets no rule, under [ADR-0093](0093-a-value-that-bypasses-the-types-gets-no-rule.md) and principle 7. A middleware that holds a plain `number`, such as a child's exit code, narrows it to `ExitCode` itself. Help, version, and any other takeover that assigns nothing still exit 0.
- **The codes widen.** `ExitCode`, which `run()` resolves and a process handle's `exitCode` takes, becomes every whole number from 0 through 255. `FailureExitCode` still bounds a failure class at 1 through 125. An invocation by name's `completed` outcome gains an optional `exitCode?: ExitCode`. Core sets it when a takeover stated a code other than 0 and leaves it out otherwise, so `invoke()` reports what `run()` would exit with and an outcome that `toEqual` matched before still matches. It is optional because a test double builds this outcome too: `.changes/README.md` counts a member that the author both reads and supplies as breaking unless it is a new optional member, and an absent code has the honest default 0. `completed` now means the run ended with no failure and was not cancelled, whatever code a takeover stated.

### Locate, completion, and the projections

- **Unchanged.** [`locate`](../core/graph-inspection.md#locating-a-word) still reads an unknown command among the earlier words as `{ kind: 'none' }`, and it offers only declared children for a last word in command position, so it still agrees with the parser under [ADR-0042](0042-core-reads-a-partial-invocation-with-the-parsers-own-grammar.md). Completion, help, the manifest, man pages, MCP, skills, and suggestions read the graph, and an external command is in no graph. So none of them lists, completes, or suggests one. The suggestions plugin's view still reads the fault's `candidates`.

### The external-commands plugin

- **The plugin.** `externalCommands()` from `@loomcli/plugins/external-commands`, with the identity `@loomcli/plugins/external-commands`, declares one `'always'` middleware. It declares no option, Command, extension, view, or hook. Its reference is [External commands](../plugins/external-commands.md).
- **When it acts.** It acts only when all of the following hold:
  - `unknownCommand` is set.
  - `invokedBy` is `'argv'`.
  - The unknown word is the first word of argv, `host.argv[0]`, so no option word and no other word comes before it. This is LM-q75, which the owner confirmed on 2026-11-19. So `notes --help sync`, `notes --version sync`, and `notes --dry-run sync` report the unknown command, as they do without the plugin. A first word is always at the root, so a word under a group, as in `notes cache sync`, never reaches the plugin.
  - The word is a portable name under core's exported `isPortableName`, the one rule for every name an operator types as a command: characters from the POSIX portable filename set, `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-` or `.`. So the word holds no path separator and is never `.` or `..`. The Application's name follows the same rule, so `<application>-<word>` is a portable filename.

  In every other case it calls `next()`, and the unknown command raises as it does today. So `notes a/b` is refused as unknown and never names a path.
- **Finding the program.** The plugin resolves the program itself and never asks the runtime to search:
  - It reads `PATH` from `host.env`, which holds what environment preparation added, and never from `process.env`. On Windows, where a variable's name has no case, it follows Node's documented rule for a child's environment: it sorts the keys and takes the first that matches `PATH` without regard to case, so `PATH` wins over `Path` when both are present.
  - It splits the value on `;` on Windows and `:` elsewhere, by `host.platform`, and walks the entries in order. An entry that is not an absolute path, an empty entry included, is skipped, so no lookup reaches the working directory. This deviates on purpose from git and POSIX, which search the working directory for an empty or relative entry: a working folder never supplies a program the operator did not install on `PATH`.
  - In each entry it looks for a candidate named `<graph.name>-<word>`: a regular file, following a symbolic link, that the run's user may execute. On POSIX it checks the execute bit with `accessSync(path, constants.X_OK)` after `statSync(path).isFile()`, as git's `locate_in_PATH` checks it. On Windows it looks for `<graph.name>-<word>.com` and then `<graph.name>-<word>.exe` instead, in the order libuv and the default `PATHEXT` try them, the files a spawn without a shell can start, and a regular file is enough, because Windows has no execute bit. The first candidate is the program. A name that fails either check is passed over: a missing file, a dangling symbolic link, a directory, a file without the execute bit, and an entry that cannot be read.
  - It reads the filesystem through `node:fs`'s `statSync` and `accessSync` at the paths the host's facts give, as the [configuration plugin](../plugins/config.md) looks up its file and the self-update plugin checks a directory. The host has no filesystem member, so the host supplies the facts, never `process`, and `node:fs` reads them.

  When no candidate is found, the plugin calls `next()`, and the held unknown command raises byte for byte as without the plugin, as git reports a word whose only file is not executable as not a git command.
- **Running it.** The plugin starts the absolute path it found through [`host.spawn`](../core/host.md#child-programs) with `rest` as its arguments:
  - It runs no shell to evaluate a word. Where the system's `execvp` hands a file with no `#!` line that it cannot run as a binary to `/bin/sh`, as Linux does, that file runs as a script with the same separate arguments, so the `ENOEXEC` sentence applies only where the runtime reports `ENOEXEC`.
  - Every stream is `'inherit'`.
  - `signal` is the run's signal.
  - `cwd` and `env` are not passed, so the child runs in `host.cwd` with `host.env`.

  The call runs inside [`out.lendTerminal`](../core/output.md#lending-the-terminal), so no live region draws over the child.
- **The outcome.** When the child exits, the plugin assigns its code to `exitCode` and returns, so the run's exit code is the child's, or 128 plus the signal number for a child a signal ended. A code outside 0 through 255, which only a Windows child gives, such as `0xC0000005` for an access violation, becomes 1. The low 8 bits are not used, because a failing code whose low byte is 0, such as 256, would then report success.

  A candidate the plugin found that still fails to start, such as one on a file system mounted without execute permission or one whose interpreter is missing, fails the run with a `FatalError`, exit 1. This covers an `unstarted` exit with any `error.code` and a throw from `spawn`. The sentence names the program by its path, states the cause in Loom's words from the error's `code`, never the runtime's message, and gives a step:
  - `EACCES`: `notes cannot run /home/ada/bin/notes-sync, because the system does not allow it to run. Check its permissions and the file system it is on, or remove it from PATH.`
  - `ENOENT`: `notes cannot run /home/ada/bin/notes-sync, because the interpreter its first line names, or the file itself, is missing. Install the interpreter, or remove the file from PATH.`
  - `ENOEXEC`: `notes cannot run /home/ada/bin/notes-sync, because this system cannot run it as a program. Replace it with a program for this system, or remove it from PATH.`
  - Any other code, or none, gets a general sentence that names the code, `because the system refused to start it (EPERM). Check that it is a program this system can run, or remove it from PATH.`

  A `FatalError` takes no prefix, so the sentence opens with the application's name.

  Presence is decided by the search, and every start error takes this one branch. So a difference between runtimes in which error a failed start reports changes only the sentence, never whether the run reports an unknown command.
- **By name.** The plugin never acts on an invocation by name. Such a run carries named values, not words, so there is nothing to hand a child as its argv. Its caller is an embedding host, a test, or an agent's tool call, not an operator at a shell whose `PATH` names the programs they chose to add. So `invoke(['foo'])` holds and raises the unknown command, with or without the plugin, as `app foo` does without the plugin.

## Considered options

- **Keeping the fault ahead of the chain and adding a not-found hook,** like oclif's `command_not_found`. Rejected. A middleware is Loom's one way to take a run over, and a second hook that ends a run is a second mechanism for one job, which principle 5 rules out.
- **Putting the word on `Request`.** Rejected. `request` is `null` under every held fault, and middleware reads a non-null one as a validated invocation. A request that held an unknown word beside empty `args` and `options` would read as a Command that validated.
- **Running option-activated middleware too.** Rejected. `app --help nope` would render the root's help instead of reporting the unknown command, which changes what an application without the plugin prints. No option was validated either.
- **Validating the global options before the word.** Rejected. The contract keeps validation skipped, and a validator's side effects would run on an invocation that reached no Command. `options` stays `null`, as it is when a global option holds a fault.
- **An exit code through a failure class.** Rejected. A failure class declares 1 through 125, every failure prints a message, and the child has already written its own. A takeover's stated code carries the child's code without a line.
- **Core runs external commands itself.** Rejected. Running a program from `PATH` is a policy an author opts in to, not a default, under principle 4. Core supplies the seam, and the plugin uses the public contract.
- **Replacing the process with the child,** as cargo and kubectl do on Unix. Not available: neither Node nor Bun can replace the running process. The application waits for the child and exits with its code.
- **Letting the runtime search `PATH` and reading the spawn's error.** Rejected. The Context gives the reasons: libuv on Windows searches the working directory first, `ENOENT` does not prove absence, and `EACCES` does not prove presence, so the branch would depend on the runtime.
- **Taking the first file of the name, executable or not, and reporting why it cannot run.** Rejected. git's `locate_in_PATH` passes over a file without the execute bit and runs an executable copy later on `PATH`, and `execvp` does the same, so an operator's habit from those tools carries over, under principle 6.
- **Searching the working directory for an empty or relative entry,** as git and POSIX do. Rejected. A working folder would then supply a program the operator did not install on `PATH`, such as a file in a cloned repository.
- **A word anywhere after the application's options** (`notes --dry-run sync`). Not adopted under LM-q75, which the owner confirmed on 2026-11-19. Options before the word belong to the application, and handing the run to a program would silently drop them.
- **The low 8 bits of a Windows code above 255.** Rejected, because a failing code can map to 0.
- **A run-time range check on `exitCode`, with its own diagnostic rule.** Rejected under ADR-0095 and ADR-0093: the type bounds the code.
- **Spawning by name.** Rejected. The reasons are in **By name** above.
- **Nested names, such as `<app>-<group>-<word>`,** as kubectl tries. Not adopted. The contract names a word at the root, and core holds the fault at every depth. So a later plugin setting can add nested names without a core change.

## Consequences

- An application without a middleware that takes over prints and exits exactly as it does today for an unknown command, with the same text, code, failure event, and `onFailure` hints. Two things change for such an application:
  - An `'always'` middleware now runs on an unknown command. A wrapper's code before and after `next()` runs, and its `next()` rejects with `UnknownCommandError`. The first-party `'always'` middleware print nothing here. The formatter reads an empty `ownOptions` and assigns nothing. The self-update notices check only a dispatched run.
  - A run cancelled while that chain runs resolves the signal's code and never raises the unknown command, as for any held fault.
- With the plugin, `app foo a --b` runs the first `app-foo` on `PATH` with `a --b` and exits with its code, a declared `foo` routes as before, `app a/b` and `app --help foo` report the unknown command, and a program in the working directory never runs unless the directory is an absolute entry of `PATH`.
- `ExitCode` widens in output position, because `run()` resolves it. `.changes/README.md` counts that as breaking, so the implementation's fragment for core is a breaking one. Its migration is to handle every code from 0 through 255 where code switches exhaustively on `ExitCode`. The `completed` outcome's new `exitCode` is optional, so a test double that builds `{ status: 'completed', output, messages }` still compiles.
- A takeover can now end a run with a nonzero code and print nothing. A consumer that switches exhaustively on `ExitCode` handles every code from 0 through 255.
- An external command that handles Ctrl-C itself, such as a REPL, is ended by it. The terminal sends `SIGINT` to both processes. The run cancels, its signal ends the child with `SIGTERM`, and the shutdown ends the application within its budget, as it does for an editor question's editor. The run exits 130. This deviates from git, the reference: `execv_dashed_external` in `git.c` runs the child with `clean_on_exit` and `wait_after_clean`, so git forwards the signal it received to the child and waits for the child to exit. Loom's run ends a child through its signal with `SIGTERM` and waits only within the shutdown's budget, as it does for every child that receives the run's signal.
- An external command is invisible to every projection, so an operator learns of it from wherever they installed it. The plugin's page states this.
- This record supersedes in part ADR-0017's sentence that an unknown command still fails in routing first, and ADR-0055's rules that an unknown command is "the one fault raised before the chain" and that every fault but an unknown command is held. Both records' other rules stand.
- It narrows five records:
  - [ADR-0032](0032-environment-and-configuration-map-into-options-through-one-core-input-source-stage.md): its 2026-10-03 entry says an unknown command ends the run before the stage; the run now continues to the `'always'` middleware with the stage skipped.
  - [ADR-0028](0028-plugins-run-code-at-lifecycle-hooks-and-middleware-reads-the-request.md): the context carries `unknownCommand`, `invokedBy`, and `exitCode` beside `request`, which answers one more part of its open question about request facts.
  - [ADR-0059](0059-a-command-runs-by-name-through-invoke.md): the `completed` outcome gains `exitCode`.
  - ADR-0095: its `ExitCode` bullet widens to every whole number from 0 through 255.
  - ADR-0097: its rule that a fulfilment exits 0 becomes a fulfilment whose action never dispatched exiting with the stated code, for a middleware that never called `next()` and for one that caught the fault the boundary raised.
- ADR-0017, ADR-0028, ADR-0032, ADR-0055, ADR-0059, ADR-0064, ADR-0095, and ADR-0097 carry dated entries.
- These records stand unchanged:
  - ADR-0042, because `locate` keeps reading an unknown command as `none`.
  - ADR-0160, because the word that is unknown is unchanged.
  - ADR-0090, because verbosity still settles 0.
- The reference amends with it:
  - [Commands](../core/commands.md#global-consumption-and-routing), [Middleware](../core/middleware.md), [Invocation](../core/invocation.md), [Input sources](../core/input-sources.md), [Interaction](../core/interaction.md), [Plugin contract](../core/plugin-contract.md#activation), [Failures](../core/failures.md), and [Signals](../core/signals.md).
  - [Verbosity](../core/verbosity.md), [Testing](../libs/testing.md), and the help and manifest plugins' pages.
  - The glossary's **Routing**, **Lifecycle hook**, **Exit code**, and **Middleware**, and its new **External command**.
  - The plugin pack's index.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-19: Proposed for letting an operator extend an application from `PATH` (LM-396). It supersedes in part ADR-0017's and ADR-0055's rule that an unknown command fails before the chain, and narrows ADR-0028's middleware context, ADR-0032's entry on the stage, ADR-0059's `completed` outcome, ADR-0095's `ExitCode`, and ADR-0097's exit 0 for a fulfilment.
- 2026-11-19: Matched git's search after review. A candidate on POSIX is a regular file the run's user may execute, checked with `accessSync` and `X_OK`, as git's `locate_in_PATH` checks it, so a file without the execute bit is passed over and a later executable copy runs, and a word with no candidate reports the unknown command. Skipping a relative or empty `PATH` entry is stated as a deliberate deviation. Windows tries `.com` before `.exe`, and takes `PATH` over `Path` by Node's sorted-key rule.
- 2026-11-19: Settled after review. The plugin finds the program by walking the run's `PATH` itself and spawns the absolute path, because a spawn's error cannot say whether a program exists. The word follows `isPortableName`. The plugin acts only on the first word of argv (LM-q75). `exitCode` is typed `ExitCode` with no run-time check and no diagnostic rule, under ADR-0095 and ADR-0093, and a takeover includes a caught boundary fault. The `completed` outcome's `exitCode` is optional.
- 2026-11-19: Implemented (LM-396). The owner confirmed LM-q70, LM-q71, LM-q72, LM-q73, and LM-q75 on 2026-11-19. The `completed` outcome carries `exitCode` only when a takeover stated a code other than 0, so an author's existing exact match of a completed outcome still holds. The failure sentence opens with the application's name, because a `FatalError` takes no prefix. `@loomcli/testing`'s `middlewareContext` gains `unknownCommand`, `invokedBy`, and `exitCode`, read as `null`, `'argv'`, and `undefined` when unstated.
