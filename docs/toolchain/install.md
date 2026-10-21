---
description: "The installer script: install.sh and the release shape it reads."
---

# The installer script

```text
install.sh [--dir <directory>] [<version>]
install.sh --help
```

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/me/notes/main/install.sh | sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/me/notes/main/install.sh | sh -s -- --dir /opt/notes/bin 1.4.0
```

```text
notes: Downloading notes-linux-x64 from the latest release of me/notes.
notes: Installed /home/me/.local/bin/notes.
notes: /home/me/.local/bin is not on PATH. Add it to your shell's PATH to run notes:
  export PATH="/home/me/.local/bin:$PATH"
```

`install.sh` installs the application's binary from a GitHub Release, verified against the release's `SHA256SUMS`, and records the installation in the [installation record](../core/installation-record.md), so self-update may later replace the binary. `loom init` renders it as a [managed file](init.md#managed-files). It runs under POSIX `sh` on Linux and macOS. [ADR-0072](../decisions/0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) records the decision.

- **What init renders.** The piece `install` writes `install.sh` in the package directory, executable, from the application's name, under [the application's name](init.md#scaffold-files), and the GitHub repository, read from `package.json` `repository` with the rule `loom build --release` uses, when the address names GitHub: `owner/name`, `github:owner/name`, or a URL or SSH address whose host is `github.com`. When `repository` is missing, cannot be read, or names another host, init writes no script and prints `warning: install.sh was not written because package.json names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom init again.` The script records the installation under that name, and core reads the record under the Application's name, so the two must match, as a scaffold keeps them.
- **The header.** A shell file's managed header is `# Managed by loom init. sha256:<hex>` on the line after its `#!` line, and the checksum covers the file without that line.
- **The version.** An optional argument, such as `1.4.0` or `1.5.0-next.2`, with or without a leading `v`, names the release `v<version>`. With no version, the script installs the repository's latest release, which GitHub never resolves to a draft or a prerelease. A version holding any character other than a letter, a digit, `.`, `-`, or `+` is an argument error.
- **The directory.** `--dir <directory>` names the install directory, by default `$HOME/.local/bin`. It must be an absolute path, and like every installed path it holds no quote, backslash, or control character. Trailing slashes are removed from it. With no `--dir`, a `HOME` that is unset, empty, or not an absolute path fails with the recipe's `HOME` sentence, whatever `XDG_STATE_HOME` holds. The script creates the directory when it is missing, just before it downloads, and a failed install leaves a directory it created empty. The binary is `<directory>/<name>`, and a directory at that path fails the install.
- **Arguments.** `--help` and `-h` print the usage to stdout and exit 0. An unknown option, a `--dir` without a value or with a relative path, a second version, and a malformed version each print one sentence and the usage line to stderr and exit 2. The script reads no environment variable of its own.
- **The platform.** `uname -s` gives the operating system and `uname -m` the architecture:

  | `uname -s` | `uname -m` | Asset |
  | --- | --- | --- |
  | `Darwin` | `arm64`, or `x86_64` under Rosetta | `<name>-darwin-arm64` |
  | `Darwin` | `x86_64` | `<name>-darwin-x64` |
  | `Linux` | `x86_64` or `amd64` | `<name>-linux-x64` |
  | `Linux` | `aarch64` or `arm64` | `<name>-linux-arm64` |

  Rosetta reads as `sysctl -n sysctl.proc_translated` printing `1`; a `sysctl` that fails or prints anything else, as on an Intel Mac, which has no such key, means native. On Linux, `ldd --version` mentioning `musl` on stdout or stderr means the C library is musl, and the asset gains `-musl`, such as `notes-linux-x64-musl`. A missing `ldd`, or one that fails without mentioning `musl`, means glibc. Any other operating system or architecture fails and names what `uname` printed.
- **Before downloading.** The script checks, in order, its arguments, the platform, a downloader, a digest tool, the install directory, and the installation record's directory, which the first part of the [installation record's recipe](../core/installation-record.md) resolves and creates. A failure in any of them downloads nothing and installs nothing.
- **Downloading.** The asset and `SHA256SUMS` come from `https://github.com/<repository>/releases/download/v<version>/`, or from `https://github.com/<repository>/releases/latest/download/` with no version, where `<repository>` is the `owner/name` init read from `package.json` `repository`, which need not match the application's name. `curl` runs with `--fail --location --silent --proto '=https' --proto-redir '=https' --tlsv1.2`, so no redirect leaves HTTPS. With no `curl`, the script uses a `wget` whose `--version` names GNU Wget, and runs it with `--quiet --secure-protocol=TLSv1_2` on the HTTPS URL. GNU Wget does not limit the protocol of a redirect, so under `wget` only GitHub's HTTPS responses choose where a download goes. BusyBox `wget` may not verify certificates, so it counts as no downloader. A failed download prints the script's own sentence, naming the URL, and none of the downloader's. A digest tool is `sha256sum`, else `shasum -a 256`. A missing downloader or digest tool fails and names what to install.
- **Verifying.** The script reads the asset's digest from `SHA256SUMS` under [the release shape](#the-release-shape). A `SHA256SUMS` that lists no line for the asset, or two lines for it with different digests, fails and names the asset and the release. A download whose SHA-256 digest differs fails and names the asset.
- **Placing.** The download lands in a staging file that `mktemp` creates in the install directory, `.<name>.XXXXXX`, and `SHA256SUMS` in a second one there, `.<name>.sums.XXXXXX`. Once verified, the script makes it executable with mode `755` and renames it to `<directory>/<name>` with `mv -f`, which replaces an existing file or symbolic link of that name whole. A running copy of the old binary keeps running.
- **Recording.** After the rename, the second part of the installation record's recipe writes `install.json` with the method `script`, the path `<directory>/<name>`, and the digest of the binary in place. Installing again replaces the record, so the last install wins.
- **Cleanup.** A trap removes the staging file and the downloaded `SHA256SUMS` when the script exits. `SIGHUP`, `SIGINT`, and `SIGTERM` end the script with exit 1 through the same trap, because `dash` runs no exit trap when a signal ends it.
- **PATH.** After the install, when no `:`-separated entry of `PATH` is exactly the install directory, the script prints that the directory is not on `PATH` and the `export` line that adds it. When `command -v <name>` finds a file other than the installed binary, the script names the file that runs first and says to remove it or move the install directory earlier on `PATH`. It never edits a shell profile.
- **Output.** Every line goes to stderr and opens with `<name>: `, other than `--help`, which goes to stdout, and the indented `export` line. A failure is one sentence that says what went wrong and one that says what to do, under [ADR-0047](../decisions/0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md), and exits 1, or 2 for an argument error.
- **A whole script or none.** The script defines each step as a function and calls them from its last line, so a download that `curl | sh` cuts short runs nothing.
- **What it never does.** The script never runs the downloaded binary, never asks for elevated rights, never writes outside the install directory and the installation record, and takes no input that exists only for tests. It does not run on Windows.

## The release shape

```sh
# A repository's own release workflow, for version 1.4.0 of notes:
for target in darwin-arm64 linux-x64 linux-arm64; do
  loom build --release --target "bun-$target" --out "dist/notes-$target"
done
(cd dist && sha256sum notes-* > SHA256SUMS)
gh release create v1.4.0 dist/notes-* dist/SHA256SUMS   # add --prerelease for 1.5.0-next.2, --latest=false for an older line
```

The installer script and self-update read a release in one shape, which each repository's own release workflow publishes:

- **The tag.** A release is the GitHub Release of the tag `v<version>`, where `<version>` is the package's `version`. The latest release is the one GitHub's `releases/latest` resolves, which is never a draft or a prerelease. GitHub reads neither from the tag: a version with a prerelease part, such as `1.5.0-next.2`, is published as a GitHub prerelease, and a release that is not the highest stable version, such as a `1.3.1` after `1.4.0`, is published with `--latest=false`, so `releases/latest` stays the highest stable version.
- **The assets.** One binary per platform, named `<name>-<os>-<arch>`, with `-musl` for a musl Linux build: `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64`, `linux-x64-musl`, and `linux-arm64-musl`. A release carries the ones it supports. Each is the binary `loom build --release --target bun-<os>-<arch>` compiles, whose release facts name the same asset. An `x64` build with the `-baseline` or `-modern` variant is not an asset the script fetches.
- **`SHA256SUMS`.** One line per asset: 64 lowercase hexadecimal digits, two spaces or a space and `*`, and the asset's file name, then a newline. This is what `sha256sum` and `shasum -a 256` print in the directory that holds the assets. A reader matches the file name exactly and ignores every other line.

## Installer script acceptance

The installer script is proven when process runs of a rendered `install.sh` under `/bin/sh` on Linux and macOS produce these results, with a fake `uname`, `sysctl`, `ldd`, `curl`, and `wget` first on `PATH` that serve a fixture release and record each URL they are asked for:

- **Installing.** With no arguments, the script fetches `releases/latest/download/` URLs, writes a binary with mode `755` and the fixture's bytes to `$HOME/.local/bin/<name>`, and writes `install.json` with the bytes the recipe pins. `1.4.0`, `v1.4.0`, and `--dir` with an absolute directory each fetch the `releases/download/v1.4.0/` URLs or install into that directory. A second install replaces the binary and the record.
- **Refusing.** A digest mismatch, an asset `SHA256SUMS` does not list or lists twice with different digests, a failed download, an unknown operating system or architecture, and a directory at the binary's path each exit 1. An unknown option, a relative `--dir`, a second version, and a version holding `/` each exit 2. Each leaves the install directory as it was, or empty when the script created it, writes no `install.json`, and leaves no staging file. With no `--dir`, a relative `HOME` exits 1 with nothing downloaded, and so does an unset `HOME` with an absolute `XDG_STATE_HOME`. A run ended by `SIGTERM` during the download leaves no staging file.
- **The platform.** Each `uname` row fetches its asset. `sysctl.proc_translated` printing `1` on `Darwin` `x86_64` fetches `darwin-arm64`, and a failing `sysctl` there fetches `darwin-x64`. An `ldd --version` that mentions `musl` fetches the `-musl` asset, and a missing `ldd` fetches the glibc asset.
- **Downloaders.** With no `curl`, a `wget` whose `--version` names GNU Wget downloads with it. A BusyBox `wget`, and no downloader at all, exit 1 and name `curl`. A `SHA256SUMS` request answered with an HTTP error exits 1 with the script's download sentence.
- **PATH.** An install directory that is not on `PATH` prints the `export` line. One that is on `PATH` prints none, also when `--dir` was given with a trailing slash. Another file of the same name earlier on `PATH` is named.
- **The record.** For each case of the [directory acceptance](../core/installation-record.md#installation-record-acceptance), unset, empty, relative, and absolute `XDG_STATE_HOME` and `HOME`, run with an absolute `--dir`, the directory the script writes `install.json` into is the one `applicationDirectory('installation', name, host)` gives for that `env` on the running platform, and a case the resolver answers with `{ variable }` exits 1 with nothing downloaded. The rendered script holds both parts of the recipe in `docs/core.md` byte for byte. A rendered script cut short at any line runs nothing.
- **Init.** The [loom init acceptance](init.md#loom-init-acceptance) covers rendering, drift, and the missing repository.
