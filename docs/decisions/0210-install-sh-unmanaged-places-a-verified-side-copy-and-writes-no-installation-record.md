---
type: adr
title: ADR-0210 - install.sh --unmanaged places a verified side copy and writes no installation record
description: The installer script takes an explicit --unmanaged flag. It verifies and places the binary as before, then writes no install.json, prints no PATH advice, and runs no post-install command, printing the skipped command line where one is declared. A binary with no record keeps today's behavior, so self-update refuses it. It amends ADR-0072's verify, place, then record rule and its advice-never-edits PATH clause, and ADR-0113's message-last and same-script clauses.
status: accepted
created: 2026-11-19
modified: 2026-11-21
---

# ADR-0210 - install.sh --unmanaged places a verified side copy and writes no installation record

## Context

[ADR-0072](0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) has the installer script verify the binary, place it, and then record it in `install.json`, and installing again replaces the record, so the last install wins. An operator who runs `install.sh --dir <scratch>` beside a live install, to try a release or to keep a second copy, rewrites the record so that it names the scratch binary. Core trusts the record only when its path resolves to the running binary, so the live binary then reads no installation, and self-update refuses it.

uv and cargo-dist name this case an unmanaged install: the files are placed, and nothing records them as the installation the tool maintains.

## Decision

- **An explicit flag.** `install.sh --unmanaged` installs a side copy. The mode is never inferred from `--dir`, because an operator may install to another directory for a reason that is not a side copy, and the record then belongs to that install.
- **A directory is required.** `--unmanaged` without `--dir` is an argument error, `--unmanaged needs --dir <directory>, the directory for the side copy.`, because the default directory holds the live binary, which the install would replace while the record kept naming it. Requiring the directory does not infer the mode from it, so the rejected option below stands. A `--dir` that names the live install's directory replaces the live binary, and the flag does not guard against it.
- **What it keeps.** The script checks its arguments, the platform, its tools, and the install directory, runs the record recipe's path-character check alone, refusing a quote, a backslash, or a control character in the install path with the same sentence, because a digest tool escapes such a file name in its output and the authentic download would then fail its digest check, downloads the asset and `SHA256SUMS`, verifies the digest, and places the binary through the staging file and the rename, exactly as it does without the flag.
- **What it skips.** It resolves and creates no installation record directory, writes no `install.json`, prints no PATH advice, and runs no post-install command. Where the package declares a post-install command, it prints the skipped command line under its own sentence, `Skipped the post-install command, which would point shared setup at this copy. Run it only to make this copy the one that is set up:`, because the command run from the side copy would point shared setup at the scratch copy; `--skip-post-install` keeps its sentence, `Run it to finish setting up <name>:`. It prints no post-install message. An existing `install.json` stays byte for byte as it was.
- **Shared files stay with the live install.** The files a plugin writes once per user, such as completion, a service, and MCP registrations, stay pointed at the live installation, because the side copy ran no command that rewrites them.
- **No new core fact.** A binary with no record keeps today's behavior. In a directory outside the package-manager roots, self-update refuses it with its sentence that the binary was installed some other way, and update notices skip it. A side copy placed under a Homebrew Cellar or a package manager's global root, such as npm's `<prefix>/lib/node_modules`, has no record either, so core derives the installation from its path under ADR-0211: self-update refuses it as that package manager's, and when the release facts give a command, such as the baked `npmPackage` for npm, pnpm, Bun, and Yarn, the update notice and the refusal name that command; without one, the notice is skipped and the refusal names only the package manager. A side copy that gets no package-manager advice takes a `--dir` outside those roots.
- **Always present.** The flag exists in every rendered script, whether or not the package declares a post-install command.

## Considered options

- **Inferring it when `--dir` differs from the recorded path.** Rejected. It reads the record before installing and guesses an intent that the operator can state in one word.
- **A record with a different method, such as `unmanaged`.** Rejected. Core and self-update would learn a second kind of installation to ignore it, and a side copy has nothing to maintain.
- **Writing the record only when none exists.** Rejected. A first install with `--dir` somewhere else is then recorded as the installation, which is the case the record exists for, and the rule hides which install wins.
- **A separate script.** Rejected. It would repeat the verification, the one step a side copy must not skip.

## Consequences

An operator installs a verified copy beside a live install, and the live install keeps its record and its self-update. A side copy cannot update itself, and the operator replaces it by running the script again with the flag. The post-install message is skipped with the command, because it describes the next step of an install that finished. A script that never receives the flag differs from the one an earlier toolchain rendered only by the flag's parsing, its usage line, its `--help` line, and the guards that skip the record, the PATH advice, and the post-install step, so `loom init` reports a managed `install.sh` as out of date once. It amends [ADR-0113](0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md): the message no longer prints after a skipped command under `--unmanaged`, and the script is no longer byte for byte the same for an Application with no declaration.

## Status

Accepted in 0.20.0.

## Changelog

- 2026-11-19: Proposed for `install.sh --unmanaged` (LM-550).
- 2026-11-19: `--unmanaged` requires `--dir`, and a skipped command under it prints its own sentence.
- 2026-11-19: Qualified after the milestone review (LM-550). A side copy placed under a Homebrew Cellar or a package manager's global root reads as that package manager's installation through ADR-0211's path rules, so it gets that package manager's refusal, and its notice and command when the release facts give one. A side copy without package-manager advice takes a `--dir` outside those roots.
- 2026-11-19: `--unmanaged` runs the recipe's path-character check, because GNU `sha256sum` escapes a file name that holds a backslash or a newline, and the authentic download then failed its digest check.
