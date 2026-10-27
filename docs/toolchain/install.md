---
description: "The installer script: install.sh and the release shape it reads."
---

# The installer script

This page documents `install.sh`, the installer script that installs an application's binary from a GitHub Release, and the release shape it reads. An author reads it to publish releases the script can install.

```text
install.sh [--dir <directory>] [<version>]
install.sh [--dir <directory>] [--skip-post-install] [<version>]   # when the application declares a post-install command
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

```ts
const app = new Application('mimir', {
  postInstall: { command: ['setup'], message: 'Run mimir init in a project to start tracking work.' },
  // ...
});
```

```text
mimir: Downloading mimir-linux-x64 from the latest release of me/mimir.
mimir: Installed /home/me/.local/bin/mimir.
mimir: Running the post-install command:
  /home/me/.local/bin/mimir setup
Registered mimir with Claude Code.
mimir: Run mimir init in a project to start tracking work.
```

`install.sh` installs the application's binary from a GitHub Release, verified against the release's `SHA256SUMS`, and records the installation in the [installation record](../core/installation-record.md), so self-update may later replace the binary. An application may declare a [post-install command](#the-post-install-command) the script runs once the install is recorded and a [post-install message](#the-post-install-message) it prints last. `loom init` renders it as a [managed file](init.md#managed-files). It runs under POSIX `sh` on Linux and macOS. [ADR-0072](../decisions/0072-init-renders-an-installer-script-that-installs-a-verified-release-binary-and-records-it.md) records the decision.

- **What init renders.** The piece `install` writes `install.sh` in the package directory, executable, from the application's name, under [the application's name](init.md#scaffold-files), and the GitHub repository, read from `package.json` `repository` with the rule `loom build --release` uses, when the address names GitHub: `owner/name`, `github:owner/name`, or a URL or SSH address whose host is `github.com`. When `repository` is missing, cannot be read, or names another host, init writes no script and prints `warning: install.sh was not written because package.json names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom init again.` The script records the installation under that name, and core reads the record under the Application's name, so the two must match, as a scaffold keeps them. Init loads the [application module](../glossary.md#toolchain) on every run that writes `install.sh`, whether or not it writes the entry, and reads the Application's [`postInstall`](../core/application.md#the-post-install-declaration) from its built graph. A package with no application module, and one whose module init writes in the same run, gets a script with no post-install step. A module that cannot be loaded prints `warning: install.sh was not written because src/application.ts could not be loaded: <reason>. Install the package and run loom init again.`, and one that exports no Application loom can read prints `warning: install.sh was not written because src/application.ts exports no Application loom can read. Export one Application from src/application.ts, then run loom init again.`, and in both init writes no script and leaves an existing one alone. A declaration fault, thrown while the module loads or raised by the build of its graph, `@loomcli/core/post-install-unrouted` included, prints its Developer Diagnostic, init writes no script, and init exits 1 once it has written the other pieces.
- **The header.** A shell file's managed header is `# Managed by loom init. sha256:<hex>` on the line after its `#!` line, and the checksum covers the file without that line.
- **The version.** An optional argument, such as `1.4.0` or `1.5.0-next.2`, with or without a leading `v`, names the release `v<version>`. With no version, the script installs the repository's latest release, which GitHub never resolves to a draft or a prerelease. A version holding any character other than a letter, a digit, `.`, `-`, or `+` is an argument error.
- **The directory.** `--dir <directory>` names the install directory, by default `$HOME/.local/bin`. It must be an absolute path, and like every installed path it holds no quote, backslash, or control character. Trailing slashes are removed from it. With no `--dir`, a `HOME` that is unset, empty, or not an absolute path fails with the recipe's `HOME` sentence, whatever `XDG_STATE_HOME` holds. The script creates the directory when it is missing, just before it downloads, and a failed install leaves a directory it created empty. The binary is `<directory>/<name>`, and a directory at that path fails the install.
- **Arguments.** `--help` and `-h` print the usage to stdout and exit 0. `--skip-post-install` skips the post-install command, and exists only in a script whose application declares one; in any other it is an unknown option, and `--help` lists it only where it exists. An unknown option, a `--dir` without a value or with a relative path, a second version, and a malformed version each print one sentence and the usage line to stderr and exit 2. The script reads no environment variable of its own.
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
- **The post-install step.** After the PATH advice, the script runs the [post-install command](#the-post-install-command), and then prints the [post-install message](#the-post-install-message), as the sections below state. An application that declares neither gets the script with no post-install step, byte for byte the script an earlier toolchain rendered.
- **Output.** Every line goes to stderr and opens with `<name>: `, other than `--help`, which goes to stdout, the indented `export` line, the indented post-install command line, and the post-install command's own output, which passes through to the script's stdout and stderr. A failure is one sentence that says what went wrong and one that says what to do, under [ADR-0047](../decisions/0047-an-operator-message-says-what-went-wrong-and-what-to-do-instead.md), and exits 1, or 2 for an argument error.
- **A whole script or none.** The script defines each step as a function and calls them from its last line, so a download that `curl | sh` cuts short runs nothing.
- **What it never does.** The script runs the installed binary only as the application's post-install command, never asks for elevated rights, writes nothing itself outside the install directory and the installation record, and takes no input that exists only for tests. What the post-install command writes is the application's. It does not run on Windows.

## The post-install command

```text
mimir: Running the post-install command:
  /home/me/.local/bin/mimir setup
mimir: The post-install command failed with exit status 3, and mimir is installed. Run it again to finish setting up mimir:
  /home/me/.local/bin/mimir setup
mimir: Skipped the post-install command. Run it to finish setting up mimir:
  /home/me/.local/bin/mimir setup
```

The post-install command is one command the application declares as argument words in [`postInstall.command`](../core/application.md#the-post-install-declaration), such as `['setup']` or `['completion', 'install']`. The script runs the installed binary with those words once the install is recorded. [ADR-0113](../decisions/0113-an-application-declares-a-post-install-message-and-command-that-the-installer-script-prints-and-runs.md) records the decision.

- **The words.** Init renders each word as a single-quoted shell word, so the script passes it to the binary byte for byte, and no character is rejected. In a development build, core checks that the words route to a Command with an action, under [the post-install declaration](../core/application.md#the-post-install-declaration).
- **When.** The command runs once, after `install.json` is written and after the PATH advice, so a command that reads the installation record finds the installation it describes. It runs as `<directory>/<name>` followed by the words, by absolute path, so an install directory that is not on `PATH` runs it the same.
- **The command line.** The script prints the command on a line of its own, indented two spaces, as the installed path and the words, each quoted for `sh` when it holds a character the shell reads specially, so the operator can copy it to run the command again. Each line below that names the command ends with a colon and is followed by that line.
- **The announcement.** Before it runs, the script prints `<name>: Running the post-install command:` and the command line.
- **stdin.** The command reads the script's stdin when that is a terminal, as under `sh install.sh`. Otherwise it reads `/dev/tty` when that opens, as under `curl ... | sh`, where the script itself arrives on stdin. Otherwise, as in CI or a container build, it reads `/dev/null`. The application's own [interaction](../core/interaction.md) rules then decide whether it asks anything.
- **Everything else is inherited.** The command runs in the script's working directory with its environment, stdout, and stderr.
- **A failure.** A command that exits with a status other than 0 prints `<name>: The post-install command failed with exit status <status>, and <name> is installed. Run it again to finish setting up <name>:` and the command line, and the script goes on to the message and exits 0, because the binary is verified, placed, and recorded. Its own output has said why it failed.
- **A signal.** A `SIGHUP`, `SIGINT`, or `SIGTERM` the script receives while the command runs, as Ctrl-C delivers it to both, ends the script through its trap with exit 1, as at any other step, and the installed binary and `install.json` stay in place. A signal that reaches the command alone ends it with a status above 128, which is a failure as above.
- **Skipping it.** Under `--skip-post-install`, the script runs nothing and prints `<name>: Skipped the post-install command. Run it to finish setting up <name>:` and the command line in place of the announcement.
- **Not on self-update.** [Self-update](../plugins/self-update.md) never runs the command; a plugin refreshes after a replace through `afterReplace`. Running the installer script again runs the command again.
- **What the command keeps.** A command that records what it binds at install, such as the directories an application resolved, writes a file of the application's own in the [installation record](../core/installation-record.md), which self-update leaves in place.

## The post-install message

The post-install message is text the application declares in [`postInstall.message`](../core/application.md#the-post-install-declaration), such as what to run next. The script prints it last, after the post-install command ran, failed, or was skipped, and after the PATH advice when no command is declared.

- **The text.** Init renders the message as a single-quoted shell word, so it prints byte for byte, and no character is rejected. It holds no placeholder; the installed path is in the lines above it.
- **Each line.** The message goes to stderr, and each of its lines opens with `<name>: `. A line break at the end of the message ends its last line.

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
