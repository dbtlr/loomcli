---
type: adr
title: ADR-0111 - The MCP plugin registers its server with Claude Code and Codex through each agent's CLI
description: The mcp Command keeps serving when routing selects no child and gains install, uninstall, and config. install registers the application's name and the command line host.program then mcp with Claude Code and Codex at user scope, through each agent's own registration CLI started with host.spawn, and never edits an agent's file. It records each registration in one record file per agent; it replaces a recorded registration, refuses a same-named one it did not record unless --force, and uninstall removes recorded registrations alone. Any build registers, and a build that is not distributed says the registration runs this checkout. config prints the mcpServers object for agents with no registration CLI. install and uninstall refuse on Windows.
status: proposed
created: 2026-10-26
modified: 2026-10-26
---

# ADR-0111 - The MCP plugin registers its server with Claude Code and Codex through each agent's CLI

## Context

[ADR-0063](0063-the-mcp-plugin-serves-opted-in-commands-as-tools.md) serves an application's opted-in Commands as MCP tools over stdio, and an agent finds the server only when its own configuration names the command that starts it. Nothing in the pack writes that configuration, so an operator edits each agent's file by hand, and an application that wants its tools found, such as Mimir, ships its own instructions for every agent.

Claude Code and Codex each ship a registration CLI. `claude mcp add` writes Claude Code's configuration at local, user, or project scope, and refuses a name its scope already holds. `codex mcp add` writes Codex's user configuration alone and replaces a name it already holds. Both start a registered stdio server in the directory the agent was started from, so an application that resolves its project from its working directory serves every repository from one user-scope registration. Probes on Claude Code 2.1.310 and Codex 0.164.0 found that `claude mcp get` and `claude mcp list` start each server they report as a health check, that `codex mcp get <name> --json` exits 1 for a name it does not hold, that `claude mcp remove` of a name it does not hold exits 1 and `codex mcp remove` exits 0, and that `claude mcp remove` without a scope fails when a name is held at two scopes, and that Claude Code refuses a server name holding `.`, which Codex accepts. Cursor, Claude Desktop, and most other clients read one JSON file shaped `{ "mcpServers": { <name>: { "command", "args" } } }` and ship no CLI.

## Decision

- **Three children of `mcp`.** `mcp` keeps its action and serves exactly as ADR-0063 states when routing selects no child, so the command line every client launches is unchanged. It holds `install`, `uninstall`, and `config`, the first first-party plugin Command with both an action and children, which a Command with no arguments may hold. No child carries `mcpCommand`, so none is a tool.
- **Through each agent's CLI.** `install` registers with Claude Code through `claude mcp add -s user <name> -- <command line>` and with Codex through `codex mcp add <name> -- <command line>`, each started through `host.spawn` by name with `host.env` and no shell, and `uninstall` removes through each agent's `mcp remove`. Loom never reads or writes an agent's configuration file, so the agent keeps its format, scope precedence, backups, and approval rules. The registration's name is the application's name with each `.` written as `_`, because Claude Code refuses a server name that holds anything but letters, digits, `-`, and `_`, and its command line is `host.program`'s words then `mcp`.
- **Two agents in one table.** The agents are `claude` and `codex`, in that order, held in one table of the MCP plugin's, so another agent that ships a registration CLI is one entry. They are not the skills plugin's agent targets: a target is a folder layout that several agents read, and an agent here is one program with a registration CLI, so each plugin keeps its own table. Both plugins name the option `--agent`.
- **User scope only.** Every registration is at the agent's user scope, and no option names a scope. A project file is committed and shared while the command line is an absolute path on one operator's machine, and a scope that one agent of two offers is an option that fails for the other.
- **Which agents.** `install` with `--agent` acts on that agent, and fails when its CLI cannot start. With no `--agent`, it acts on every agent whose CLI starts, names each it skipped, and fails when none starts. Whether a CLI starts is read from `host.spawn`'s `unstarted` outcome for its `--version` call, never from a search of `PATH`. `uninstall` acts on the agents the record lists, narrowed by `--agent`.
- **The record owns registrations.** Each agent's registration is recorded in the plugin's own file for that agent in the installation record, `mcp.claude.json` and `mcp.codex.json`, through the installed-files module, written `pending` before the agent's CLI runs and `committed` after the call settles. A failed `add` writes the file back to what is known to be registered, so it never records a registration the plugin did not make. Only a run that ends before the call settles, such as a killed process, an agent call the run signal ends, or a record write that fails leaves a file pending, and a pending file is read as recorded; once the run signal aborts, no further agent call starts.
  - `install` replaces a recorded registration: Claude through `remove` then `add`, a failed `remove` falling through to `add`, and Codex through `add`, which replaces.
  - A same-named registration the record does not list refuses `install` unless `--force`. Codex is checked through `codex mcp get <name> --json` before any agent is written: an answer of 0 refuses, 1 reads as a name Codex does not hold, and any other answer, or a check that cannot start, fails the install with nothing written. Claude's own `add` refuses a taken name, and Loom reports every failed `add` alike, with its output, and names `--force`, because no Claude call checks a name without starting the server. Under `--force`, Claude's registration is removed and added, Codex's added, and each is recorded.
  - `uninstall` removes each recorded registration and deletes its record file whatever the agent's `remove` answers, passing the answer on. A registration still present is met by a later `install` as one the record does not list, which `--force` takes back. A recorded agent whose CLI cannot start keeps its record file, and `uninstall` says so and fails, because its configuration likely still names the server.
- **Any build.** `install` registers from a `source`, `development`, or `distributed` build, and its output names the command line it registered. A build that is not distributed adds a line that the registration runs this checkout, and a source build adds that the registration keeps no runtime flags, because `host.program` is the runtime and the script alone, so a loader such as `--import tsx` is not passed on. An agent starts the server on demand, so a registration that outlives its checkout is a stale entry the operator sees and a re-run or `uninstall` corrects, and registering the build under development is how an author tries a server in an agent.
- **No update.** There is no `update` child and no refresh after a self-update, because a self-update replaces the binary at the path the registration names. A re-run of `install` registers a moved program.
- **A printed configuration.** `config` prints `{ "mcpServers": { <name>: { "command", "args" } } }` for the same command line to stdout alone, writes no file, reads no record, and runs from every build and platform, so an operator adds it to an agent that ships no registration CLI.
- **Not on Windows.** `install` and `uninstall` refuse on `win32` before they act and name `config`, as the completion plugin's installing children do under [ADR-0101](0101-completion-installs-on-linux-and-macos-and-a-startup-line-is-written-or-printed.md). `host.spawn` runs no shell, and an agent CLI installed as a `.cmd` shim cannot start without one, so a present CLI would read as missing.

The rules are stated in [Registering with an agent](../plugins/mcp.md#registering-with-an-agent).

## Considered options

- **Editing each agent's configuration file.** Reaches every agent and checks a name with no side effect. Rejected. Loom would race a running Claude Code over a file it rewrites, need a TOML editor that keeps the operator's comments for Codex, and own every agent's file layout as it changes, which is each agent's contract.
- **A shared agent table with the skills plugin.** One module listing each agent's skills folder and registration CLI. Rejected. The two lists share one name, `claude`: a skills target such as `agents` stands for several agents, and a registration goes to one program, so a shared table holds entries that half apply.
- **`mcp` as a group of `serve`, `install`, and `uninstall`.** Rejected. Every client configuration already launches `mcp`, so moving the server to `mcp serve` breaks each one.
- **A separate root Command such as `mcp-register`.** Rejected. It places two plugin Commands at the root for one capability, where every other installing plugin groups its children under one.
- **Refusing a build that is not distributed**, as the service plugin does. Rejected. A service runs on with no owner, while a registration is a line an agent reads on demand, and a stale one is visible and corrected by a re-run.
- **No ownership, by name alone.** Install always removes and adds by name, and uninstall removes by name. Rejected, because it replaces a hand-made registration of the same name, such as one that runs a development build, without asking.
- **Checking Claude through `claude mcp get`.** Rejected, because it starts the server it reports.
- **A `--scope` option.** Rejected under User scope only.

## Consequences

The MCP plugin's Commands now write outside the application, through two programs Loom does not ship. The calls Loom makes and how it reads their answers are Loom's to test, and each agent's own behavior is checked by hand against named versions; a change to an agent's CLI is a change this plugin follows. The installed-files module gains a fourth kind of entry, a registration, which it records but never applies itself, because the agent's CLI does the writing.

An application that serves MCP can register at install time through a setup Command of its own, once an installer runs a post-install command.

## Status

Proposed. It moves to accepted with the release that ships `install`, `uninstall`, and `config`, once their tests run under Node and Bun on a mock whose programs stand in for `claude` and `codex`, and a probe against the real CLIs in throwaway home folders is recorded with their versions.
