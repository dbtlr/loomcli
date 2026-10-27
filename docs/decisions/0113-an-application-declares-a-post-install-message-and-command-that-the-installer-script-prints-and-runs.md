---
type: adr
title: ADR-0113 - An application declares a post-install message and command that the installer script prints and runs
description: The Application's postInstall option declares a message and one command as argument words, carried on the built graph and never acted on by core at run time. A development build's graph check reports words that route to no Command with an action. loom init renders them into install.sh, which, after the binary is verified, placed, and recorded, announces and runs the installed binary with the words, its stdin the operator's terminal when there is one and /dev/null otherwise, warns and still exits 0 when the command fails, skips it under --skip-post-install, and prints the message last. Self-update never runs the command. A file an application writes in its installation record under a name no first-party writer uses is the application's own.
status: proposed
created: 2026-10-27
modified: 2026-10-27
---

# ADR-0113 - An application declares a post-install message and command that the installer script prints and runs

## Context

[ADR-0072](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) has the installer script install a verified binary and record it, and nothing more: "The script never runs the downloaded binary". Its one reason was that no flag is safe to run on every Loom application, because `--version` exists only when the version plugin is installed. An application then has no way to tell the operator what to do after the install, or to do it for them. An application that serves MCP can register its server with the operator's agents through a setup Command of its own under [ADR-0111](0111-the-mcp-plugin-registers-its-server-with-claude-code-and-codex-through-each-agents-cli.md), and an application that binds its directories at install, as Mimir does, keeps a receipt of its own beside the binary, because nothing application-owned runs at install time.

A command the author names answers ADR-0072's reason, because the author knows which Commands the application has. Established installers that run their binary run one fixed setup step: Volta's script runs `volta setup` unless `--skip-setup`, Claude Code's prints `Setting up Claude Code...` and runs `claude install`, Bun's runs `bun completions` and ignores its failure, and Deno's runs its shell setup with `/dev/tty` as stdin when `curl | sh` holds the script's stdin. mise, starship, uv, and cargo-dist run nothing. Package managers keep a message and a command apart, as Homebrew's `caveats` and `post_install` and Scoop's `notes` and `post_install` do, and give the operator a way to refuse the command, such as `brew install --skip-post-install` and `npm install --ignore-scripts`. None of the installer scripts takes its step from an application author.

Installation is core's concept: core defines the [installation record](../core/installation-record.md) under [ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) and reads it into the release facts, and the toolchain renders the script from that record's recipe. A `package.json` key would be a configuration file in another form, which [ADR-0099](0099-an-assembly-check-from-loomcli-testing-replaces-loom-check.md) carries forward from ADR-0066's rule that the toolchain reads none. `loom init` already loads the application module to learn its exports, so it can read a declaration the Application carries.

## Decision

- **A core option.** `ApplicationOptions` gains `postInstall?: { message?: string; command?: readonly [string, ...string[]] }`. The built graph carries it as `CommandGraph.postInstall`, so `inspect()` reports it, and core never acts on it at run time. It is an installation fact, as the installation record and the release facts are, not a fact a projection reads, so it is no precedent for projection facts in core. A `postInstall` with neither member declares nothing.
- **Argument words.** The command is the words an operator types after the application's name, such as `['setup']` or `['completion', 'install']`, run as the installed binary's absolute path followed by the words. One command, not a list: an application with several steps writes a Command that runs them. `loom init` renders each word and the message as single-quoted shell words, so no character is rejected.
- **A development check that the words route.** In a development build, `inspect()` and `run()` route the words as an invocation's argv is routed, under [ADR-0055](0055-an-invocation-routes-on-global-options-then-parses-the-routed-commands-words-against-one-table.md), and report `@loomcli/core/post-install-unrouted` when routing selects no Command or a Command with no action; `check()` and the assembly check run it in every build, as they run the converter check. The routed Command's own inputs are not parsed. A distributed `inspect()` and `run()` run no such check, as they run no converter check, so the fact cannot break a shipped application.
- **Init reads the module.** The piece `install` loads the application module on every run that writes `install.sh`, and reads `postInstall` from its built graph. A module that cannot be loaded or exports no Application draws a warning and no script, and a declaration fault, at load or at build, draws its Developer Diagnostic, no script, and exit 1. A package with no application module, or one whose module init writes in the same run, gets a script with no post-install step.
- **After the record.** The script runs the command once, after the binary is placed and `install.json` is written, and after the PATH advice, so a command that reads the installation record finds it. Before it runs, it prints `<name>: Running the post-install command:` and, indented on a line of its own, the command as an operator would copy it. The command inherits the script's environment, working directory, stdout, and stderr.
- **The operator's terminal, or none.** The command's stdin is the script's stdin when that is a terminal, else `/dev/tty` when it opens, else `/dev/null`. Under `curl | sh` the script itself arrives on stdin, which no command may read. The application's own interaction rules then decide whether it asks anything.
- **A failure warns.** A command that exits non-zero prints that it failed with its exit status, that the application is installed, and the command to run again, and the script exits 0, because the binary is verified, placed, and recorded. A signal the script receives while the command runs, as Ctrl-C delivers it to both, ends the script through its trap with exit 1, as it does at any other step; a signal that reaches the command alone is a failure with its status.
- **The operator may skip it.** `--skip-post-install` skips the command and prints the command to run later. The option exists only in a script whose application declares a command; in any other it is an unknown option.
- **The message last.** The message prints after everything else, whether the command ran, failed, or was skipped, to stderr with each of its lines opening with `<name>: `.
- **Not on self-update.** Self-update never runs the command, because a plugin refreshes after a replace through `selfUpdate({ afterReplace })`. Running the installer script again runs it again.
- **The application's own file in the record.** A file an application writes in its installation record's directory under a name no first-party writer uses is the application's own. No Loom writer reads, replaces, or removes it, so it survives a self-update, and an application can record what it binds at install there from its post-install command.
- **No declaration, the same script.** An Application with no post-install message or command gets today's script byte for byte. Init's read of the module is new for it, so a module init cannot read now leaves the script unwritten.

The rules are stated in [The installer script](../toolchain/install.md), [Application declarations](../core/application.md), and [Installation record](../core/installation-record.md).

## Considered options

- **A `package.json` key that `loom init` reads beside `name` and `repository`.** Rejected. It is a configuration file in another form, it is untyped, and it is checked only when init runs.
- **A `loom init` option.** Rejected. Init re-renders the script on every run, so a run without the option would drop the command.
- **An extension value from `@loomcli/plugins`.** Rejected. It splits one core concept, installation, across two packages, and makes an application import a plugin package for a fact no plugin reads.
- **A marker on a Command in place of argument words.** Rejected. A marked Command takes no arguments, and an author cannot mark a plugin's Command, so even `completion install` would need a wrapper Command.
- **Rejecting a quote, backslash, or control character in the words, as an installed path does.** Rejected. That rule protects the path `install.json` records through `printf`, which the words never reach, and quoting them for the shell takes any word whole.
- **A check only in `loom init`.** Rejected. An author who renames the Command and does not re-run init learns of it only from an operator's install, while the assembly check in the author's own tests catches it on every run.
- **stdin from `/dev/null` alone.** Rejected. It forbids a setup Command from asking anything on a terminal, which an application's interaction rules already govern.
- **A confirmation the script asks itself.** Rejected. It adds a second consent above the application's own questions, and with no terminal it either asks nothing or skips the command, which breaks unattended installs.
- **Failing the install when the command fails**, as Claude Code's script does. Rejected. The exit status says whether the application is installed, and it is; automation that needs the setup to succeed passes `--skip-post-install` and runs the Command itself.
- **`--no-post-install`.** Rejected. It reads as the negated form of a Boolean option, and Homebrew spells the same choice `--skip-post-install`.
- **Running the command after a self-update.** Rejected. `afterReplace` already refreshes what a replace leaves stale.

## Consequences

The installer script now runs the author's code on the operator's machine, so what it writes outside the install directory and the installation record is the application's, and the script says so in the line it prints before running it. The script stays POSIX `sh`, whole-script-or-none, with no input that exists only for tests: the tests run a fake released binary that records its argument words and its stdin.

An application that binds its directories at install, such as Mimir, binds them from its post-install command into a file of its own in the installation record, which self-update leaves in place and a re-run of the installer writes again, so it needs no receipt of its own beside the binary.

## Status

Proposed. It moves to accepted with the release that ships `postInstall`, once the installer suite runs the script under Node and Bun with a fake released binary and a real pseudo-terminal case shows the command reading `/dev/tty` under `curl | sh`.
