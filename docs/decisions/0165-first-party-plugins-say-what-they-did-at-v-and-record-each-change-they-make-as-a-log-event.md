---
type: adr
title: ADR-0165 - First-party plugins say what they did at -v and record each change they make as a log event
description: The first-party plugins that act on files, programs, or the environment say what they did at -v, one out.debug line per act, and how they decided at -vv, one out.trace line per place looked or thing passed over, through the lanes' own views; a confirmation a Command already prints is not repeated. The configuration plugin names the file it read or that it found none, and each place it looked; dotenv counts the variables each file imported and names each one it skipped, with the reason and never a value; update notices name the cache read, a refresh started, the first reason they did nothing, and a cache they ignored; the self-update Command names the release it resolved, the asset it verified, the binary it replaced, and each request; the service plugin names each manager call; the completion, man page, and skills refreshes name a refresh run or skipped, and skip one when nothing is installed; the MCP plugin names each record file it checked; the logging plugin names its file and each rotation. Each change a plugin makes outside the process is one info log event from four shared messages, File written., File removed., Program run., and Binary replaced. An onEnvironment hook's out gains debug and trace, a log destination gains the outermost run's debug and trace lanes, a plugin Command's action logs under its plugin's identity, AfterReplaceContext gains name and out, and RefreshContext gains optional name and out. It supersedes ADR-0080's clause that the notice part reports none of its faults, ADR-0069's clause that every action's log names no plugin, and, for that log identity alone, ADR-0033's clause that a plugin Command's action receives what every action receives.
status: proposed
created: 2026-11-16
modified: 2026-11-16
---

# ADR-0165 - First-party plugins say what they did at -v and record each change they make as a log event

## Context

Loom keeps two channels apart under [ADR-0069](0069-core-hands-log-events-to-onlog-hooks-and-writes-no-log-record.md): `out` writes for the operator now, and `log` records for a reader later. An operator's `-v` and `-vv` settle the run's verbosity right after graph build under [ADR-0090](0090-an-operators-v-or-q-settles-the-runs-verbosity-right-after-graph-build.md), and `out.debug` writes from `-v`, `out.trace` from `-vv`. cargo, npm, and git use those levels to say what the tool did: the file it read, the request it sent, the program it ran.

The first-party plugins say almost nothing there. The configuration plugin's `Ignored` lines under [ADR-0118](0118-the-configuration-plugin-reads-one-schema-described-file-through-a-provider-and-drops-what-the-schema-rejects.md) and [ADR-0154](0154-the-configuration-plugin-names-at-v-each-key-the-published-json-schema-does-not-describe.md) are the only `out.debug` calls in `@loomcli/plugins`, and ADR-0090's own example, a configuration source naming the file it read, is not built. No plugin records a side effect as a log event, so a log file holds an action's events and core's failures, and nothing says which files an install wrote or which programs a service command ran.

Four facts of the code shape the answer:

- An [`onEnvironment`](../core/plugin-contract.md#environment-preparation) hook's `out` holds `warn` alone, under ADR-0090's Every writer clause and [ADR-0102](0102-dotenv-imports-every-variable-the-process-has-not-set.md), although the hook runs after the verbosity settles.
- An [`onLog`](../core/lifecycle-hooks.md#observing-log-events) hook receives an event and the outermost run's destination, with no `out`, so the logging plugin cannot say which file it writes or that it rotated one.
- Every action's `log` names no plugin, a [plugin Command](../core/plugin-contract.md#plugin-commands)'s included, under ADR-0069, because nothing records which plugin attached a Command. An event the completion, man page, skills, service, MCP, or self-update Command raised would read `plugin: null`, like the application's own.
- The completion, man page, and skills refreshes of [ADR-0076](0076-the-skills-plugin-installs-an-applications-agent-skills-for-claude-and-the-shared-agents-folder.md), [ADR-0079](0079-the-manpage-plugin-writes-a-roff-page-per-command-and-installs-the-set-in-the-home-folder.md), and [ADR-0101](0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md) receive the self-update Command's `afterReplace` context, which holds no `out` and no application name, so a refresh can neither write a line nor find the installation record to tell whether anything is installed.

The owner settled the rulings on 2026-11-15 and 2026-11-16 (LM-371): what `-v` and `-vv` say, the sentence or pattern for each plugin, which plugins print nothing, the four log events and their fields, the lanes the lines go through, and that this record supersedes by name [ADR-0080](0080-the-self-update-plugin-tells-an-interactive-operator-about-a-newer-release-from-a-daily-cache.md)'s clause that the notice part reports none of its faults, while the notice part still never changes the exit code.

## Decision

### What -v and -vv say

- **Two levels.** At `-v` a plugin says what it did, one line per act: a file read, values imported, a cache used, a release resolved and verified, a program run, a file written or replaced. At `-vv` it adds how it decided: where it looked, and what it passed over and why. A confirmation the Command already prints at the default verbosity is not repeated at `-v`, and neither is a warning's fact. The default verbosity gains no line.
- **The lanes.** A `-v` line is one `out.debug(message)` call and a `-vv` line one `out.trace(message)` call, each with no view argument, so the lane's own view, [`lanes.debug`](../core/verbosity.md) or `lanes.trace`, renders it, and an application's override of that lane renders it too. No line passes [`step()`](../plugins/pack-views.md#step) or another view.
- **Sentences.** Each sentence is a named export of the plugin's `messages.ts` beside the code that writes it, under [ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md), and the logging plugin gains one. Every value a line repeats, a path, a variable name, a URL, a version, a channel, a program and its words, an asset, passes through `escapeControlCharacters` under rule 5 of the [failure message voice](../core/failures.md#failure-message-voice), and a path or a URL is kept on one line with `nowrap`, as each plugin's other sentences keep one. A line the configuration plugin writes shows its file as its warnings and `Ignored` lines do, escaped with `style.escape` before the call. Each package's voice test reads the new sentences.
- **The lanes' rules hold unchanged.** The verbosity is the verbose count, read as 2 above 2, less the quiet count, read as 1 above 1, so `-v -q` writes no line, `-vv -q` writes the `-v` lines alone, and `-q` alone writes none. Both lanes write to stderr whether or not it is a terminal; off a terminal nothing wraps and the gutters stay, as [Verbosity](../core/verbosity.md) states, and on a terminal each line lands above the open live regions, as every stderr write does. An [invocation by name](../core/invocation.md#invocation-by-name), `app.invoke` or an action's `invoke`, settles its own verbosity from the values it lowers, so `verbose: 1` shows the `-v` lines in its `messages`. An [MCP](../plugins/mcp.md) tool call runs at verbosity 0 under the verbose plugin, so the lines its own run writes show none; the logging plugin's lines go through the outermost run's lanes, so under a tool call they follow the serving run's verbosity.

### Where a line is written

Each line goes through an `out` that already follows the run's verbosity, or one this record adds:

| Surface | Its `out` |
| --- | --- |
| The configuration source and the `config` provider | The `out` each receives, under ADR-0090 and [ADR-0116](0116-a-providers-opener-receives-out-style-and-the-graph.md). The two share one read per run, so each line is written once, by whichever reads first. |
| Dotenv's `onEnvironment` hook | The hook's `out`, which gains `debug` and `trace`. Environment preparation runs after the verbosity settles and only for a new outer run, so the lines appear once per outer run. |
| The update notices' middleware | The middleware's `out`. |
| A plugin Command's action: self-update, service, MCP, completion, man page, skills | The action's `out`. |
| The completion, man page, and skills refreshes | The `out` of the `afterReplace` context, which the self-update Command fills with its action's `out`. |
| The logging plugin's `onLog` hook | The destination's `out`: the outermost run's `debug` and `trace` lanes, at that run's verbosity. |

No first-party plugin writes a line from `onCommandAttach` or `onGraphBuilt`, which receive no `out`. Every surface in the table runs after the run's verbosity settles, an `onLog` hook included: core logs no event before then, because a failure raised before the graph is built logs none and every context that carries `log` starts after the verbosity settles. No plugin therefore writes a line the verbosity has not yet decided, and core holds no early line, as ADR-0090 rejects a buffer.

### The lines of each plugin

**Configuration** (`@loomcli/plugins/config`). `<file>` is the file as the plugin's labels show it: a candidate in the working directory as `file` names it, any other discovered file as its full path, and the `--config` file and the variable's file as the operator wrote them.

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Read configuration from <file>.` | Once the file the lookup chose, the named file, the variable's, or a discovered one, is read and parses, before any `Ignored` line about it. |
| `-v` | `Found no configuration file.` | The lookup ends with no file found: no step found one, a variable that names a missing file included. Not under `--no-config`, which reads nothing by the operator's word; not when the `notice: true` notice prints, because its `out.info` line opens with the same sentence; and not after a broken file, whose warning already says the run reads no configuration. With `notice: true`, a run whose notice does not print, because the variable names a missing file or the lookup looks nowhere, writes this line. |
| `-v` | `Ignored <path> in <file>: <message>` | Unchanged, under ADR-0118 and ADR-0154. |
| `-vv` | `Looked for <file>: not found.` | Once for each candidate path the lookup checks and finds nothing at, in the lookup's order, the variable's missing file included. In the directory where the lookup finds a file, only the candidates before that file write a line: a later candidate that is absent writes none, and one that is present keeps its warning and writes none. |

**Dotenv** (`@loomcli/plugins/dotenv`). `<file>` is the file's name in `host.cwd`, as its warnings name it. A line names variables and counts them, and never holds a value.

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Imported 3 variables from .env.local.`, or `Imported 1 variable from .env.` | Once for each file that imports at least one name, after the plugin reads that file, in reading order, the most specific first. A file imports each name it assigns that the settings allow, the hook's environment does not define, and no more specific file supplied, and the count is those names. A name the environment already defines is skipped, because core keeps the environment's value. |
| `-vv` | `Skipped <name> from <file>: on the except list.` | A name the file assigns that `except` lists. |
| `-vv` | `Skipped <name> from <file>: not on the only list.` | A name the file assigns that `only` does not list. |
| `-vv` | `Skipped <name> from <file>: already set.` | A name the hook's environment already defines, an empty value included, which core keeps. |
| `-vv` | `Skipped <name> from <file>: already set from <specific>.` | A name a more specific file, `<specific>`, already supplied. |

Each name passed over writes one line, after its file's `-v` line, in the order the file first assigns the names, with the first reason that holds, in the table's order: the settings' list, then the environment, then a more specific file. A name on a malformed line keeps its warning, or its silence, under [ADR-0125](0125-dotenv-layers-mode-and-local-files-in-buns-order-expands-references-and-ends-an-unquoted-value-at-any-hash.md), and gets no line. A file that is missing writes nothing. A file that imports no name writes no `-v` line, and its names still write their `-vv` lines.

**Update notices** (`@loomcli/plugins/self-update`). `<cache>` is the full path of `update.json`, as the cache's other sentences show its directory.

| Level | Line | When |
| --- | --- | --- |
| `-vv` | `Skipped the update check: <reason>` | The middleware does nothing, naming the first condition of ADR-0080 that fails, in its order, with the reasons below. |
| `-v` | `Read the update check from <cache>.` | The cache file holds an update cache this version reads, whether or not it is stale. |
| `-vv` | `Ignored <cache>: it is not an update cache this version reads.` | Something is at the path that cannot be read, is not a regular file, does not hold the cache's object, or holds a `format` other than `1`. A missing cache writes nothing. A `format` 1 object for another repository or channel, or whose `latest` is not a version, is a stale cache this version reads, under ADR-0080: it writes the `Read` line and no `Ignored` line, and the middleware refreshes it. |
| `-v` | `Started a refresh of the update check.` | The detached refresh child was started, once `host.spawn` returns it. A `checked` time that cannot be written, and a child that cannot start at the call, start nothing and write no line. |

The reasons, in ADR-0080's order: `NO_UPDATE_NOTIFIER is set.`; `<variable> is set.`, naming the author's `env`; `stdout is not a terminal.`; `stderr is not a terminal.`; `CI is set.`; `self-update is running.`; `<name> is not a release binary.`; `<name> was not installed by install.sh.`; and `<variable> is not an absolute path.`, naming the variable the cache directory's lookup answers. The first condition, that the action ran and the run signal has not aborted, writes no line when it fails: the notice part speaks only after an action, and a cancelled run writes nothing more. `notices: false` installs no middleware, so nothing is written. The notice keeps its `out.info` line. The middleware writes in the order it acts: `Read` once it reads the cache, then the notice when the cache names a newer release, then `Started` once the refresh starts. The update check is the notice part's daily look for a newer release, which the glossary names; the notice is the line it may print.

**The self-update Command** (`@loomcli/plugins/self-update`). Its lines fall between the lines it already prints:

| Level | Line | When |
| --- | --- | --- |
| `-vv` | `Requested <url>.` | Before each request the Command sends, each redirect it follows included, under `--check` and `--refresh-notice` too. |
| `-v` | `Resolved v1.5.1 on the stable channel.` | A run without a version found the newest release on the channel it follows, and that release is newer, so the run goes on to replace. It is written once the lookup ends and before the `Downloading` line. The newer-only lines and the `--check` line already name the release, so those runs write none, and a named version is the operator's own, so it writes none. |
| `-v` | `Verified notes-linux-x64 against SHA256SUMS.` | The downloaded asset's digest matches the one `SHA256SUMS` lists. |
| `-v` | `Replaced /home/me/.local/bin/notes.` | The verified bytes were renamed over the recorded path, before the record is rewritten. |

The order of a replacing run at `-vv` on the stable channel is: each `Requested` line of the lookup, `Resolved`, the `SHA256SUMS` request, `Downloading` at `info`, the asset's request, `Verified`, `Replaced`, then `Updated notes from 1.5.0 to 1.5.1.` at `success`, then what `afterReplace` writes. On any other channel the lookup reads the release feed and then requests each candidate's `SHA256SUMS`, newest first, until one answers, so those requests belong to the lookup and come before `Resolved`, and no `SHA256SUMS` request follows it. The installation record's rewrite is bookkeeping that the log records and no line repeats, as for every plugin below.

**Service** (`@loomcli/plugins/service`).

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Ran systemctl --user daemon-reload.` | Once for each service manager call that started, once it ends, whatever its code: every `systemctl --user` and `loginctl` call on systemd and every `launchctl` call on launchd, the reads `status` makes and each `print` of launchd's unload wait included, and a read the five-second limit ended. A program that cannot start writes no line, because its failure names it. |

The words are the program and its arguments joined by single spaces, as the plugin's failure sentence repeats a call, so launchd reads `Ran launchctl bootstrap gui/501 /Users/me/Library/LaunchAgents/com.acme.notes.plist.` and `Ran launchctl kickstart -k gui/501/com.acme.notes.` The `Wrote`, `is unchanged`, `Removed`, `Started`, `Stopped`, and `Restarted` lines already confirm the plugin's other acts.

**Completion, man pages, and skills** (`@loomcli/plugins/completion`, `manpage`, `skills`). Their Commands print a confirmation for each script, startup line, page, and skill folder they write or remove, so they gain no line of their own. The refresh each exports gains these:

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Refreshed completion after the update.`, `Refreshed the man pages after the update.`, `Refreshed the skills after the update.` | The refresh child exited 0. |
| `-vv` | `Skipped the completion refresh: nothing is installed.`, `Skipped the man page refresh: nothing is installed.`, `Skipped the skills refresh: nothing is installed.` | The refresh did not run, because the installation record holds none of the plugin's files. |

- **Nothing is installed.** Before it starts the child, a refresh whose context carries `name` looks in `applicationDirectory('installation', name, host)` for the plugin's files: `completion.<shell>` for any shell, the man page plugin's file, or the skills plugin's file for any target. When none exists, it starts no child, writes its `-vv` line, and resolves. It reads only whether each file exists, so an unreadable or damaged record still runs the child, whose failure names the fix. A directory that does not resolve, and a context without `name`, run the child as before. This is the one reason a refresh does not run.
- **A child that fails.** A child that exits with any code but 0, or cannot start, keeps its `warn` log event and the line it writes to `host.stderr`, and writes no `-v` line.
- **No `out`.** A refresh called with a context that carries no `out` writes no line and otherwise acts the same.

**MCP registration** (`@loomcli/plugins/mcp`).

| Level | Line | When |
| --- | --- | --- |
| `-vv` | `Checked /home/me/.local/state/notes/installation/mcp.claude.json.` | Once for each selected agent's record file that `mcp install` or `mcp uninstall` reads, in table order, whether or not it exists. The path is shown as the record's other sentences show it. |

Its `Registered`, `Removed`, `Replaced`, and `Skipped` lines confirm every registration it changes, so it has no `-v` line.

**Logging** (`@loomcli/plugins/logging`). `<file>` is the log file's absolute path as the plugin resolved it.

| Level | Line | When |
| --- | --- | --- |
| `-v` | `Logging to <file>.` | Once per outermost run, after the first record the plugin appends to the file in it. A run that appends none writes no line. |
| `-vv` | `Rotated <file>.` | After each rotation that renamed or deleted the file, with `keep: 0` included. |

With `to: 'console'` the records reach stderr themselves, so the plugin writes neither line. The plugin still writes nothing to `destination.stderr` but records.

**Every other plugin.** Help, format, color, theme, verbose, interaction, suggestions, manifest, version, background, patch-console, plain, and the pack's views print nothing at `-v` or `-vv`, and `@loomcli/prompts` is a library with no lines.

### Change events

- **One event per change.** A first-party plugin records one `info` log event for each change it makes outside the process, from four messages shared by every plugin:

  | Message | Fields | The change |
  | --- | --- | --- |
  | `File written.` | `{ path }` | A file created or rewritten, a startup file whose line was added, replaced, or removed included, and an installation record file at each write. |
  | `File removed.` | `{ path }` | A file deleted, a leftover staging file included. |
  | `Program run.` | `{ program, arguments, code }` | A child program that changes something, once it exits with a code the plugin treats as success. |
  | `Binary replaced.` | `{ path, from, to }` | The self-update Command's rename over the recorded path, with the replaced and the new version. |

  `path` is the absolute path, `program` the program as the plugin starts it, `arguments` the array of words it passes, and `code` the number it exited with. The four messages live in one internal module of `@loomcli/plugins`, with one function per message that takes the `log` and the fields, so every plugin raises them the same way.
- **Which plugin.** The event's `plugin` field tells the plugins apart. A middleware's `log` already names its plugin. An action's `log` names the plugin whose `commands` list contributed its Command, or a Command above it, so a plugin Command's events read `@loomcli/plugins/service`, `@loomcli/plugins/completion`, and so on. The application's own actions, a nested `invoke` of one included, still name none. Core keeps which plugin listed each Command beside the graph, not in it: `inspect()`, the manifest, help, and every hook read a plugin Command as they read any Command, and the `log` identity is the one thing its action receives that an application's action does not. A refresh logs through the `afterReplace` context's `log`, which is the self-update action's, so its events name `@loomcli/plugins/self-update`, and their `arguments` tell the refreshes apart.
- **What records nothing.** A read records nothing: reading a file, a status read, `launchctl print`, `systemctl show`, `loginctl show-user`, an agent's `--version` call or `codex mcp get`, PowerShell's `$PROFILE` answer, and a request. A failed change records nothing, because the failure core reports is its own event: a write or a rename that throws, a program that cannot start, and one whose code the plugin does not accept. A directory a plugin creates for a file, or removes once it is empty, records no event of its own; a skill folder, which the skills plugin places and removes whole through its staging folder, records one `File written.` or `File removed.` under the folder's path, not one per file inside it. A change inside the process, such as dotenv's variables, which core merges into `host.env`, records nothing.
- **Each plugin's changes.**
  - The configuration plugin, dotenv, and the plugins that print nothing record no event.
  - The update notices record `File written.` for `update.json` when the middleware writes its `checked` time, and the `self-update --refresh-notice` run records it again for the cache it writes. Starting the detached refresh records no `Program run.`, because the run never learns its code.
  - The self-update Command records `File removed.` for each leftover staging file it removes, `Binary replaced.` after the rename, and `File written.` for `install.json`.
  - Every plugin that writes through the installation record, the service, completion, man page, skills, and MCP plugins, records `File removed.` for each leftover staging file it removes beside a file it writes, as the self-update Command does.
  - The service plugin records `File written.` and `File removed.` for its unit file and its installation record file, and `Program run.` for each manager call that changes a unit: `systemctl --user` with `daemon-reload`, `enable`, `restart`, `start`, `stop`, or `disable`, and `launchctl` with `enable`, `bootout`, `bootstrap`, or `kickstart`. `code` is the code the plugin accepted, such as `5` from `systemctl stop` for a unit that is not loaded, or `113` from `launchctl bootout`.
  - The completion plugin records the script, the startup file, and each shell's record file; the man page plugin each page, `generate`'s included, and its record file; the skills plugin each skill folder and each target's record file.
  - The MCP plugin records each agent's record file, its pending, committed, and restored writes and its deletion, and `Program run.` for each `claude` or `codex` call with `mcp add` or `mcp remove` that exits 0. A `claude mcp remove` before an `add` that exits otherwise falls through to `add` and records nothing.
  - A refresh records `Program run.` for its child when it exits 0.
  - The logging plugin records none. Its `onLog` hook receives no `log`, and an event it raised through another plugin's would come back to its own hook. Every other plugin that changes something outside the process raises its events through the `log` its action, middleware, or `afterReplace` context already receives, so none needs a new one.
- **No secret in `arguments`.** Every `Program run.` a first-party plugin raises passes only words the plugin builds from the application's name, its unit's label and path, the user's id, the record, and `host.program`: the service manager's verbs, a unit name, `gui/<uid>`, a label, a plist path, and `-k`; the agent's `mcp add -s user <name> -- <host.program> mcp`, `mcp add <name> -- <host.program> mcp`, `mcp remove -s user <name>`, and `mcp remove <name>`; and a refresh's `completion update`, `manpage update`, or `skills update`. No event carries the child's environment, input, or output.

### The types

`EnvironmentContext`'s `out` gains the two lanes:

```ts
/**
 * Environment preparation precedes input validation and exposes no parsed invocation.
 *
 * @public
 * @sealed
 */
interface EnvironmentContext {
  /**
   * The host's working directory and a read-only snapshot of its environment, including the
   * additions earlier hooks made.
   */
  readonly host: {
    readonly cwd: Host['cwd'];
    readonly env: Readonly<Host['env']>;
  };
  /**
   * The output channel: `warn` for the operator, and `debug` and `trace`, which follow the run's
   * verbosity.
   */
  readonly out: Pick<Out, 'warn' | 'debug' | 'trace'>;
  /** Records a log event under the identity of the plugin whose hook is running. */
  readonly log: Log;
}
```

`LogDestination` gains `out`:

```ts
/**
 * Where a hook writes: the outermost run's environment, home, platform, and stderr, which is
 * `null` under an invocation by name, because that writes to no process stream, and its `debug`
 * and `trace` lanes.
 *
 * @public
 * @sealed
 */
interface LogDestination {
  /** The outermost run's environment variables. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The outermost run's `host.home`. */
  readonly home: string;
  /** The outermost run's platform name. */
  readonly platform: string;
  /** The outermost run's stderr stream, or `null` under an invocation by name. */
  readonly stderr: Writable | null;
  /**
   * The outermost run's `debug` and `trace` lanes, which follow that run's verbosity and write to
   * its stderr, or to its captured messages under an invocation by name.
   */
  readonly out: Pick<Out, 'debug' | 'trace'>;
}
```

A hook calls a lane without awaiting it, because it returns `undefined`, and catches the promise's rejection, so core's output contract alone reports a write that fails. `@loomcli/testing`'s `logDestination` fills `out` with lanes that resolve and write nothing, and `LogDestinationValues`, `Partial<LogDestination>`, gains it as an optional member.

`AfterReplaceContext` gains two members:

```ts
/**
 * What `afterReplace` reads once the binary is replaced and the record rewritten.
 *
 * @public
 * @sealed
 */
interface AfterReplaceContext {
  /** The version that was replaced. */
  readonly previous: string;
  /** The version now at `path`. */
  readonly current: string;
  /** The recorded path, as `install.json` holds it. */
  readonly path: string;
  /** The application's name, as the graph holds it. */
  readonly name: string;
  /** The run's host, whose release facts still describe the replaced binary. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
  /** The run's output channel, the self-update action's own. */
  readonly out: Out;
}
```

`RefreshContext`, which `@loomcli/plugins/completion`, `manpage`, and `skills` export as one declaration, gains two optional members:

```ts
/**
 * What a refresh reads from a self-update's `afterReplace` context.
 *
 * @public
 */
interface RefreshContext {
  /** The binary that replaced this one. */
  readonly path: string;
  /** The run's host. */
  readonly host: Host;
  /** The run signal. */
  readonly signal: AbortSignal;
  /** The run's log. */
  readonly log: Log;
  /**
   * The application's name, which finds the installation record. Without it, the refresh always
   * runs the new binary.
   */
  readonly name?: string;
  /** Where the refresh writes its `-v` and `-vv` lines. Without it, the refresh writes none. */
  readonly out?: Pick<Out, 'debug' | 'trace'>;
}
```

No export is added or removed.

The contract is in each plugin's page, [Configuration](../plugins/config.md#at--v-and-in-the-log), [Dotenv](../plugins/dotenv.md#at--v-and-in-the-log), [Self-update](../plugins/self-update.md#at--v-and-in-the-log), [Service](../plugins/service.md#at--v-and-in-the-log), [Completion](../plugins/completion.md#at--v-and-in-the-log), [Man pages](../plugins/manpage.md#at--v-and-in-the-log), [Skills](../plugins/skills.md#at--v-and-in-the-log), [MCP](../plugins/mcp.md#at--v-and-in-the-log), and [Logging](../plugins/logging.md#at--v-and-in-the-log), and in [First-party plugins](../plugins/README.md), [Verbosity](../core/verbosity.md), [Logging](../core/logging.md), [Lifecycle hooks](../core/lifecycle-hooks.md#observing-log-events), the [plugin contract](../core/plugin-contract.md#environment-preparation), [Testing](../libs/testing.md), and the [glossary](../glossary.md#logging).

## Considered options

- **Leaving the lines to `log`, read through the console destination.** Rejected. A log event is a record for a reader later, under ADR-0069 and ADR-0090, and an operator who types `-v` asks the run now.
- **Holding a line raised before the verbosity settles.** Rejected, as ADR-0090 rejects a buffer, and never needed: no surface that writes a line runs before the verbosity settles, an `onLog` hook included, because core logs no event before then.
- **A `-v` line for every installation record write.** Not taken. The record is a plugin's own bookkeeping, written before and after each act, so a line for it would double every confirmation; the log keeps it as `File written.`.
- **Naming a plugin in the event's fields while every action's `log` names none.** Rejected. The rulings tell plugins apart by the event's `plugin` field, which an author's `onLog` already reads, and core knows which plugin listed each Command it attaches.
- **Passing `-v` to a refresh child.** Rejected. The child is another run with its own verbosity, its default lines already pass through, and it cannot say that it did not run.
- **Running a refresh child when nothing is installed, as today.** Rejected. The `-vv` line says why a refresh did not run, so the refresh checks first; the child would only print that nothing is installed and how to install it, after an update the operator asked for.
- **A `Program run.` event for the detached notice refresh.** Rejected. The run neither waits for the child nor learns its code, and the child records the cache it writes.

## Consequences

`EnvironmentContext`'s `out` gains `debug` and `trace`, `LogDestination` gains `out`, and `AfterReplaceContext` gains `name` and `out`, each an output type that gains a member. `RefreshContext`, an input type, gains two optional members. `@loomcli/testing`'s `logDestination` fills the new member, and its `environmentContext` fills an unstated `out.debug` and `out.trace` as it fills an unstated `out.warn`, with a lane that resolves and writes nothing. None is breaking under the [change-fragment rules](../../.changes/README.md). At run time, an event a plugin Command's action logs names its plugin where it read `null`, and an application with completion, man pages, or skills but nothing installed no longer runs a refresh child after a self-update, so the child's line that nothing is installed no longer prints. Every other byte at the default verbosity is unchanged.

ADR-0080's clause "None is reported, and none changes the run's exit code." is superseded by name for its first half: a cache that cannot be read is named at `-vv`, and a refresh that starts is named at `-v`. A `checked` time that cannot be written and a child that cannot start still start nothing and print no line of their own, and no fault of the notice part changes the run's exit code. ADR-0069's clause that an action's `log` names no plugin, "a plugin Command's included, because nothing records which plugin attached a Command", is superseded: core records which plugin listed each Command it attaches. [ADR-0033](0033-a-plugin-attaches-ordinary-commands-to-the-root.md)'s clause "Its action receives what every action receives" is superseded in part for that identity: a plugin Command's action receives a `log` bound to its plugin, and everything else as every action does. Its clause that nothing in the graph records which plugin attached a Command still holds, because core keeps the record beside the graph. ADR-0069's rule that `out` and `log` route through neither the other still binds core, which renders no event through `out` and records no line as an event; the destination's lanes, like its `stderr`, are where a hook writes its own lines. ADR-0090's Every writer clause, that an `onEnvironment` hook's `out` keeps `warn` alone, and ADR-0102's hook receiving its `warn` call, are narrowed: the hook's `out` gains `debug` and `trace`. ADR-0070's logging plugin writes the two lines through the destination's `out`, which ADR-0069's destination gains. ADR-0073's `afterReplace` context gains `name` and `out`. ADR-0076's refresh, which ADR-0079 follows for man pages, and [ADR-0101](0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md)'s `refreshCompletion` no longer run the child when the record holds none of the plugin's files. ADR-0033, ADR-0069, ADR-0070, ADR-0073, ADR-0076, ADR-0079, ADR-0080, ADR-0090, ADR-0101, and ADR-0102 carry dated entries.

The glossary gains Change event and Update check, its Log destination entry names the destination's `out`, and its Plugin Command entry names the action's `log` identity.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-16: Proposed with the contract (LM-371). It supersedes ADR-0080's clause that the notice part reports none of its faults and ADR-0069's clause that every action's `log` names no plugin, narrows ADR-0090's and ADR-0102's `warn`-only environment hook, adds `out` to ADR-0069's destination for ADR-0070's lines, adds `name` and `out` to ADR-0073's `afterReplace` context, and skips ADR-0076's and ADR-0079's refresh when nothing is installed. ADR-0069, ADR-0070, ADR-0073, ADR-0076, ADR-0079, ADR-0080, ADR-0090, and ADR-0102 carry dated entries.
- 2026-11-16: The contract review settles what the proposal left open (LM-371). The record supersedes in part ADR-0033's clause that a plugin Command's action receives what every action receives, for the `log` identity alone, and states that ADR-0069's rule that `out` and `log` route through neither the other still binds core. A dotenv file's count leaves out a name the environment defines. The configuration plugin writes `Found no configuration file.` whenever the `notice: true` notice does not print, and no `Looked for` line for a candidate after the file found in its directory. A `format` 1 cache for another repository or channel, or with a `latest` that is not a version, is read and refreshed, never ignored. The middleware's lines follow the order it acts in. On a channel other than stable the lookup's `SHA256SUMS` requests come before `Resolved`. Every plugin that writes through the installation record records `File removed.` for a leftover staging file. The MCP record path names its `installation` folder. No `log` context runs before the verbosity settles, so no line waits on it. `@loomcli/testing`'s `environmentContext` fills `out.debug` and `out.trace`. The glossary gains Update check, and ADR-0033 and ADR-0101 carry dated entries.
