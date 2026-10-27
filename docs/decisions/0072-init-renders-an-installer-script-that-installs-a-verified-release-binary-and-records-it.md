---
type: adr
title: ADR-0072 - init renders an installer script that installs a verified release binary and records it
description: loom init renders install.sh, a managed file named for the application and its GitHub repository. Under POSIX sh on Linux and macOS it takes an optional version and --dir, picks the release asset for the platform, verifies it against the release's SHA256SUMS, moves it into place, and writes install.json through the installation record's recipe. It advises on PATH and never edits a shell profile, runs the binary, or takes a test-only input. The release shape it reads, a v<version> tag, <name>-<os>-<arch> assets, and sha256sum's output, is the shape every repository's own release workflow publishes.
status: accepted
created: 2026-10-12
modified: 2026-10-27
---

# ADR-0072 - init renders an installer script that installs a verified release binary and records it

## Context

[ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) records how an application was installed, and its `install.json` has two writers: an installer script and self-update. Self-update replaces only a binary whose method is `script`, so without an installer script that writes the record, no application that self-update serves can be installed in the first place. [ADR-0066](0066-the-toolchain-acts-on-one-package-directory.md) and [ADR-0068](0068-init-writes-scaffold-files-once-and-owns-managed-files.md) placed installer scripts with release orchestration. Release orchestration stays with each repository: its own workflow builds, publishes, and tags. The installer reads only what that workflow publishes, so it does not depend on that design.

An installer script and self-update both read a release, so they need one release shape. Loom already names a binary's asset, `<name>-` and the compile target without `bun-`, in the release facts. It has never named the tag or the checksum file. Every repository's workflow must produce that shape, so the shape is part of the contract and not an implementation detail of the script.

Established installers differ on three questions. rustup, deno, and bun scripts take arguments after `sh -s --`, and cargo-dist and uv read `<APP>_INSTALL_DIR`. rustup and cargo-dist append to the shell profile, with a flag to opt out. Many scripts ship a release-URL variable so their tests can point at a fake.

## Decision

- **A managed piece of init.** `loom init` renders `install.sh` in the package directory as a [managed file](../toolchain/init.md#managed-files), the piece `install`. It is rendered from the application's name and the GitHub repository, which init reads from `package.json` `repository` with the rule `loom build --release` uses. When the field is missing, cannot be read, or names another host, init writes no script and warns, so an author who adds the field gets the script on the next run. A shell file's header is a `#` comment on the line after its `#!` line.
- **One interface: arguments.** `install.sh [--dir <directory>] [<version>]`. With no version, the script installs the repository's latest release, which GitHub never resolves to a prerelease. A named version installs that release, so a prerelease is installed by naming it. Following a release channel after install belongs to self-update. `--dir` names an absolute directory, by default `~/.local/bin`. The script reads no environment variable of its own.
- **The release shape.** A release is the GitHub Release of the tag `v<version>`, published as a GitHub prerelease when its version has a prerelease part, and the latest release is the highest stable version. It carries one asset per platform, `<name>-<os>-<arch>`, with `-musl` for a musl Linux build, and `SHA256SUMS`, the output of `sha256sum` over the assets. `loom build --release --target bun-<os>-<arch>` names the same asset in the release facts.
- **The platform.** The script picks `darwin` or `linux`, and `x64` or `arm64`, from `uname`. Under Rosetta it picks `arm64`, and on a Linux whose `ldd` reports musl it picks the `-musl` asset. A platform it cannot name, and an asset `SHA256SUMS` does not list, fail with a sentence that names them.
- **Verify, then place, then record.** The script checks its arguments, its tools, the install directory, and the installation record's directory before it downloads anything. It downloads the asset and `SHA256SUMS` over HTTPS with `curl`, held to HTTPS on every redirect, or with GNU Wget, which fetches the HTTPS URL but cannot limit a redirect's protocol. It verifies the asset's digest, moves the binary into place through a staging file in the install directory and a rename, and only then writes `install.json` through the installation record's shell recipe. A failure before the rename leaves the install directory as it was.
- **Advice, never edits.** When the install directory is not on `PATH`, the script prints the line that adds it. When another file of the same name runs first on `PATH`, it says so. It never edits a shell profile.
- **Nothing beyond the install.** The script never runs the downloaded binary, never asks for elevated rights, and writes nothing but the binary and `install.json`. It has no input that exists only for tests: tests put fake downloaders and a fake `uname` first on `PATH`. Windows is out of scope.

The contract, the release shape, and the acceptance are in [The installer script](../toolchain/install.md).

## Considered options

- **An install-directory variable named for the application.** Rejected. Each operator learns a name per application, and the script needs a rule for turning a portable name into a variable name. Arguments give one interface, which `--help` documents.
- **Editing the shell profile.** Rejected. It writes a file outside what the installation record tracks, needs a shell-detection rule, and an operator who installs to `~/.local/bin` usually has it on `PATH`.
- **A release-URL override for tests.** Rejected. It lets anyone who sets one variable redirect where the binary comes from, and it leaves the URLs the script builds untested.
- **Running the binary to prove it works.** Rejected. A Loom application has `--version` only when it installs the version plugin, so no flag is safe to run.
- **A JSON release manifest, or one checksum file per asset.** Rejected. POSIX `sh` cannot parse JSON without `jq`, and one file per asset doubles the downloads. `sha256sum`'s output is what release pipelines already write.
- **A required version.** Rejected. A first install wants the latest release, and a pinned install names its version.
- **Rendering the script with a placeholder repository.** Rejected. The author's first edit drifts the file, which is why [ADR-0068](0068-init-writes-scaffold-files-once-and-owns-managed-files.md) does not manage scaffold files.

## Consequences

An application's README can point at `install.sh` on its default branch. The script records the installation in the directory named for the application's name as init reads it from `bin`. Core reads the record for the Application's name, so the two must match, as a scaffold keeps them. A repository's release workflow uploads the assets under the shape's names and `SHA256SUMS` beside them. An `x64` build with the `-baseline` or `-modern` variant is not an asset the script fetches. The installation record's recipe gains a marked split point, so an installer resolves the record's directory before it downloads and writes the file after the rename.

## Status

Accepted in 0.11.0.

## Changelog

- 2026-10-12: Proposed with the installer contract.
- 2026-10-12: A shell file's header follows any `#!` line, so an edited `#!` line reads as drift rather than releasing the file.
- 2026-10-12: The release lane is renamed the release channel under [ADR-0073](0073-the-self-update-plugin-replaces-a-script-installed-binary-with-a-verified-release.md), proposed.
- 2026-10-27: [ADR-0113](0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md), proposed, supersedes "Nothing beyond the install" and the considered option "Running the binary to prove it works" for an application that declares a post-install command: after the binary is placed and `install.json` written, the script announces and runs the installed binary with the declared argument words, and that command's writes are the application's. It adds a post-install message the script prints last and the `--skip-post-install` option. An application that declares neither gets the script this record describes, byte for byte. It binds when that record is accepted.
