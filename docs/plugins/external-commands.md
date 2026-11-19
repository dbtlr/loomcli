---
description: "The external-commands plugin: an operator extends an application by putting <application>-<word> on PATH, which runs as <application> <word>."
---

# External-commands plugin

This page documents the external-commands plugin. With it, an operator adds a word to an application by putting a program on `PATH`: with the plugin installed, `notes sync --all` runs a program named `notes-sync` with the argument `--all`, as `git foo` runs `git-foo`. An author installs it when the application's operators should be able to extend it without a release.

```ts
// @loomcli/plugins/external-commands
import type { Plugin } from '@loomcli/core';

export declare function externalCommands(): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { externalCommands } from '@loomcli/plugins/external-commands';
import { help } from '@loomcli/plugins/help';

export const notes = new Application('notes', { plugins: [help(), externalCommands()] });
```

```text
$ ls ~/.local/bin
notes-sync
$ notes sync --all
Synced 14 notes.
$ notes sycn
notes: Unknown command "sycn". Use one of: add, list, show.
Run "notes --help" to see the usage.
```

`externalCommands()` takes no settings. Its identity is `@loomcli/plugins/external-commands`. It declares one `'always'` middleware and no option, Command, extension, view, or hook. It reads the unknown command core holds under [Middleware](../core/middleware.md), as [ADR-0192](../decisions/0192-core-holds-an-unknown-command-for-the-chain-and-a-plugin-runs-an-external-command-from-path.md) records. An external command is a program, not a Command: the application declares nothing for it, and the graph holds nothing of it.

## When it runs a program

The plugin runs a program only when all of these hold:

- **An unknown first word.** The first word of argv names no child or alias of the root, and the root declares no argument. A declared Command always wins, including a hidden one, so an author who declares `sync` replaces the operator's `notes-sync`. On a root that declares an argument, an unknown word fills the argument and never reaches the plugin.
- **Nothing before it.** The unknown word is the very first word, with no option before it. So `notes --help sync`, `notes --version sync`, and `notes --dry-run sync` report the unknown command, as they do without the plugin, because the options before the word belong to the application and a program would silently drop them. This follows LM-q75, which the owner confirmed on 2026-11-19. A word under a group, as in `notes cache sync`, is never the first word, so it reports the unknown command too.
- **A command line.** The run is a `run()` on argv. An [invocation by name](../core/invocation.md#invocation-by-name), whose context reads `invokedBy: 'name'`, carries named values and no words to hand a program. So `app.invoke(['sync'], {})`, an action's `invoke`, and an MCP tool call never start one, and each reports the unknown command.
- **A portable word.** The word is a [portable name](../glossary.md#names-and-routing) under core's `isPortableName`, the rule every Command name follows: characters from `A-Z`, `a-z`, `0-9`, `.`, `_`, and `-`, not starting with `-` or `.`. So a word never names a path: `notes ../bin/rm` and `notes a/b` report the unknown command, and nothing runs.

In every other case the plugin continues the chain, and the run reports the unknown command exactly as an application without the plugin does: the same text, the same hints, the same exit code 2.

## How it runs the program

- **The name.** The program is the Application's name, a hyphen, and the word, such as `notes-sync`. The name is `graph.name`, the name the Application declares, whatever name the operator's shell used to start the application.
- **Finding it.** The plugin searches `PATH` itself, and the runtime never searches. It reads `PATH` from the run's environment, `host.env`, so a [dotenv](dotenv.md) import of `PATH` counts. On Windows it takes the variable named `PATH` in any case, by Node's rule for a child's environment: the keys sorted, the first match wins, so `PATH` wins over `Path`. It walks the entries in order, split on `;` on Windows and `:` elsewhere. It skips an entry that is not an absolute path, an empty one included, so the working directory is never searched. git and POSIX search the working directory for such an entry; the plugin does not, so a working folder, such as a cloned repository, never supplies a program the operator did not install on `PATH`. In each entry it looks for a regular file named `notes-sync`, following a symbolic link, that the run's user may execute, checked through `node:fs` with `accessSync` and `X_OK`, as git's `locate_in_PATH` checks it. On Windows, which has no execute bit, it looks for `notes-sync.com` and then `notes-sync.exe`, the order of the default `PATHEXT`, the files a program can start without a shell, so a `.cmd` or `.bat` script never runs. The first match is the program, and it starts by that absolute path. Everything else is passed over: a file without the execute bit, so an executable `notes-sync` later on `PATH` runs instead, a directory with the program's name, a dangling symbolic link, as git passes one over, and an entry it cannot read. With no match, the run reports the unknown command, as git reports a word whose only file is not executable.
- **The arguments.** The program receives every word after the unknown word, unchanged and in order: option words, a bare `--`, and the words after it. So `notes sync --all -- x` runs `notes-sync --all -- x`, and `notes sync --help` hands `--help` to `notes-sync`. Words before the unknown word belong to the application, and the program does not receive them. So in `notes --vault work sync`, where `--vault` is a global option the application declares, routing reads `--vault work`, but the plugin starts no program because `sync` is not argv's first word; the run reports the unknown command.
- **No shell.** The plugin starts the absolute path through [`host.spawn`](../core/host.md#child-programs), so no shell evaluates or splits a word. On Linux and other systems whose `execvp` does so, a file with no `#!` line that the system cannot run as a binary is handed to `/bin/sh` as a script, as git's external commands are; the words still reach it as separate arguments.
- **The terminal.** The program reads the run's stdin and writes to its stdout and stderr directly, so an interactive program works as it does when the operator runs it by its own name. The plugin starts it inside [`out.lendTerminal`](../core/output.md#lending-the-terminal), so no live region draws over it.
- **Where it runs.** The program runs in the run's working directory with the run's environment, which holds what environment preparation added, such as a [dotenv](dotenv.md) import.
- **Its exit code.** The run exits with the program's code, or 128 plus the signal number for a program a signal ended, as a shell reports it. A Windows program's code outside 0 through 255, such as `0xC0000005`, exits 1, because its low 8 bits could read as success. The plugin writes nothing of its own around the program.
- **Its signals.** The plugin passes the run's signal, so when the run is cancelled the program ends with `SIGTERM`. Ctrl-C reaches the program and the application both. So a program that handles Ctrl-C itself, such as a REPL, still ends with the run, and the run exits 130, under [Signals, cancellation, and shutdown](../core/signals.md). git instead forwards the signal it received to its dashed program and waits for it to exit.
- **An alias that adds options.** Because only the very first word runs a program, an operator's shell alias or wrapper that puts options before it, such as `alias notes='notes --vault work'`, makes every external command report the unknown command: `notes sync` reaches the application as `notes --vault work sync`. This follows LM-q75, which the owner confirmed on 2026-11-19.

When no match is found on `PATH`, the run reports the unknown command, as above. A match that still fails to start, such as one on a file system mounted without execute permission or one whose interpreter is missing, fails the run with exit 1, whatever error the runtime reported, with a sentence that names the file by its path, states the cause in Loom's words, and gives a step:

```text
$ notes sync
notes cannot run /home/ada/bin/notes-sync, because the interpreter its first line names, or the file itself, is missing. Install the interpreter, or remove the file from PATH.
```

A file the system refuses to run reads `because the system does not allow it to run`, and a file that is no program for the system reads `because this system cannot run it as a program`, where the runtime reports `ENOEXEC` rather than running the file through `/bin/sh`. Because the search decides whether a program exists, a runtime that reports a different start error changes only the sentence, never whether the run reports an unknown command.

## What it does not do

- **No listing.** An external command appears in no projection. [Help](help.md) lists the declared Commands alone, [completion](completion.md) completes none, and the [manifest](manifest.md), [man pages](manpage.md), [MCP](mcp.md), and [skills](skills.md) describe none. [Suggestions](suggestions.md) suggests only declared names. An operator learns of an external command from whatever installed it, so an application that expects them says where in its own documentation.
- **No nested names.** Only the first word runs a program. `notes cache sync` never looks for `notes-cache-sync`.

## Placement

The plugin's middleware is `'always'` and takes the run over when a program answers, so the `'always'` middleware installed before it wrap the program's run and the ones installed after it never run for it. Install it after the plugins that should observe every run, such as a timing wrapper.

## At -v and in the log

The plugin records one `debug` line when it starts a program, `Running /home/ada/bin/notes-sync.`, and one `trace` line for each `PATH` entry it passes over, `No notes-sync in /usr/bin.` A word list that names an unknown command settles the run's [verbosity](../core/verbosity.md) at 0, so neither line reaches the terminal. They reach a log destination, such as the [logging plugin](logging.md)'s file, at its own level. Starting a program changes nothing outside the process, so the plugin records no change event.

## Testing

The plugin searches the real filesystem, so a test puts a fixture file named for the program in a temporary directory and names that directory in the run's `PATH`. On a [`mockProcess`](../libs/testing.md#mockprocess), whose `programs` answer a command by its exact text with no `PATH` lookup, the test holds the script under the file's absolute path, and reads the exit code and the mock's streams. A `PATH` with no such file reports the unknown command, and a mock with no script for the path found throws from `spawn`, which the plugin reports as a file that failed to start. The plugin's own tests also start real fixture programs, on POSIX.
