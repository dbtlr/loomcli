---
description: How a Loom application ships. The cargo loom toolchain (init, changelog, build, and the installer script), which is not in this tree, the release facts a build bakes in, the self-update plugin, and the service plugin.
---

# Shipping

An application ships as one binary. The toolchain, `cargo loom`, scaffolds the package, cuts its version from change fragments, builds the binary with its release facts baked in, and renders the installer script that installs a release binary from GitHub. Two plugins act on the installed binary: self-update replaces it with a newer verified release, and the service plugin runs one of its Commands as a user service.

## The toolchain is not in this tree

The toolchain, the `cargo-loom` crate, is not in this tree. It stays out of the workspace until its adapter is designed, so nothing here builds or installs `cargo loom`. The sections on `cargo loom` and the installer script below document the toolchain as the port built it. Core's reading of the release facts and of the installation record, and the self-update and service plugins, are in the tree and work without it; a plain `cargo build` is a `source` build.

`cargo-loom` is a Loom application itself, and Cargo runs it as the subcommand `cargo loom`. Every command acts on the package of the nearest `Cargo.toml` at or above the working directory. A package departs from a convention, such as where the changelog lives, in `loom.config.json` beside its `Cargo.toml`. The application is named `loom`, so its help pages and messages read `loom`, as the TypeScript toolchain's do.

```text
$ cargo loom --help
loom · The Loom toolchain. It acts on the package in the working directory.

USAGE
  loom <command> [options]

COMMANDS
  build                Build the package's application with cargo, with its release facts baked in.
  changelog <command>  Check the package's change fragments and cut its version from them.
  init                 Scaffold a new application in an empty directory, or add the pieces a package lacks.
…
```

## cargo loom init

`cargo loom init` scaffolds a new application in an empty directory, or adds the pieces an existing package lacks. In an empty directory named `notes`:

```text
$ cargo loom init
Wrote Cargo.toml.
Added dependencies.loomcli-core to Cargo.toml.
Added dependencies.loomcli-plugins to Cargo.toml.
Added dev-dependencies.loomcli-testing to Cargo.toml.
Wrote src/application.rs.
Wrote src/main.rs.
Wrote src/application_test.rs.
Wrote loom.config.json.
Wrote clippy.toml.
Wrote .changes/README.md.
warning: install.sh was not written because Cargo.toml names no GitHub repository. Set repository to a GitHub address such as owner/name, then run loom init again.
```

The pieces, each of which `--only <piece>` writes alone:

- `package`: the `loomcli-core`, `loomcli-plugins`, and `loomcli-testing` dependencies in `Cargo.toml`.
- `application`: `src/application.rs`, an Application with help, version, and one Command, under `pub fn application()`.
- `entry`: `src/main.rs`, which runs the application with `main()`.
- `test`: `src/application_test.rs`, the assembly check through `loomcli_testing::assert_assembles`.
- `config`: `loom.config.json`, empty.
- `lint`: `clippy.toml`, which disallows the methods that bypass the host, such as `std::env::var`, `std::process::exit`, and `std::io::stdout`, each naming the member of the run's host to use instead.
- `changes`: `.changes/README.md`, the guide to change fragments.
- `install`: `install.sh`, the installer script, once `Cargo.toml` names a GitHub `repository`.

Scaffold files become the author's at once and are never overwritten. Managed files, `clippy.toml`, `install.sh`, and the fragment guide, carry a header with the checksum of their content, so `cargo loom init` re-renders an unedited one and reports an edited one as drift; `--force` re-renders it anyway.

The scaffold depends on the crates by version. While they are unpublished, a patch section in the package's `Cargo.toml` points them at a checkout; with it, the scaffold above builds and runs:

```toml
[patch.crates-io]
loomcli-core = { path = "../loomcli/rust/crates/loomcli-core" }
loomcli-plugins = { path = "../loomcli/rust/crates/loomcli-plugins" }
loomcli-testing = { path = "../loomcli/rust/crates/loomcli-testing" }
```

## cargo loom changelog

A package cuts its version from change fragments: one Markdown file per change in `.changes/`, written as bullets. The kind is in the file's name: `breaking.<slug>.md` for a breaking change, which also holds a `### Migration` section, `feature.<slug>.md` for a feature, and `<slug>.md` for a fix.

- `cargo loom changelog check` validates every fragment and counts them, and needs no git history, so it runs in CI.
- `cargo loom changelog write` takes the next version from the highest kind present (`0.0.0` to `0.1.0`; below `1.0.0` a breaking change or a feature raises the minor and a fix the patch; from `1.0.0` breaking raises the major, a feature the minor, and a fix the patch), prepends its section to `CHANGELOG.md`, sets `[package] version` in `Cargo.toml` (or `[workspace.package] version` for a member that inherits it), and deletes the consumed fragments. `--target <version>` cuts a chosen version or a prerelease, `--date`, `--narrative`, and `--dry-run` shape the cut.
- `cargo loom changelog notes <version>` prints one version's release notes, for a release page.

```text
$ printf -- '- Add the `hello` command.\n' > .changes/feature.hello.md
$ cargo loom changelog check
Checked 1 fragment.
```

The reference page [docs/toolchain/changelog.md](../../../docs/toolchain/changelog.md) states the fragment grammar and every rule of a cut; the Rust toolchain reads `Cargo.toml` where it reads `package.json`.

## cargo loom build and release facts

`cargo loom build` runs `cargo build --release` for the package's binary with its release facts baked in, copies the binary to `dist/<name>`, and writes its line in `dist/SHA256SUMS`:

```text
$ cargo loom build
Built dist/notes for linux-x64.
```

- `--release` bakes the release group from `Cargo.toml`'s `version` and `repository`, and names the binary by its release asset, such as `dist/notes-linux-x64`.
- `--target <triple>` builds for another target. A release names the binary with the installer script's asset scheme: `x86_64-unknown-linux-gnu` is `linux-x64`, `aarch64-unknown-linux-gnu` `linux-arm64`, `x86_64-unknown-linux-musl` `linux-x64-musl`, `aarch64-unknown-linux-musl` `linux-arm64-musl`, `x86_64-apple-darwin` `darwin-x64`, and `aarch64-apple-darwin` `darwin-arm64`. A release for any other triple fails before it builds.
- `--development` bakes a development build, `--out` and `--name` move and name the binary, and `--facts` prints the facts and builds nothing:

```text
$ cargo loom build --facts
{"build":"distributed","compiled":true}
$ cargo loom build --release --facts
{"build":"distributed","compiled":true,"release":{"asset":"notes-linux-x64","repository":"acme/notes","version":"0.0.0"}}
```

The facts travel in the `LOOM_RELEASE` environment variable of the `cargo build` that `cargo loom build` runs, and `loomcli-core`'s build script bakes them, so the application needs no build script of its own and malformed facts fail the build. A plain `cargo build` or `cargo run` is a `source` build. The run reads the facts as `context.host.release`: the build kind, the release (asset, repository, a channel core derives from the version, and the version), and the installation the installer script recorded. A source or development build prints a defect's Developer Diagnostic; a distributed build prints `<app>: Something went wrong.`

```rust
use loomcli_core::{Application, Build, Context, Release, ReleaseFacts, RunOptions};
use loomcli_testing::{MockFields, mock_process};

#[tokio::main(flavor = "current_thread")]
async fn main() {
    let about = Application::new("notes")
        .description("Keep notes.")
        .action(|context: Context| async move {
            let release = serde_json::to_string(&context.host.release.release).unwrap_or_default();
            context.out.print(&release).await
        });
    let facts = ReleaseFacts::new(Build::Distributed)
        .release(Release::new("1.4.0-rc.1", "acme/notes").asset("notes-linux-x64"));
    let process = mock_process(MockFields::new().release(facts));
    about.run(RunOptions::new().process(process.clone())).await;
    assert_eq!(
        process.stdout_text(),
        "{\"asset\":\"notes-linux-x64\",\"repository\":\"acme/notes\",\"channel\":\"rc\",\"version\":\"1.4.0-rc.1\"}\n"
    );
}
```

## The installer script

With a GitHub `repository` in `Cargo.toml`, `cargo loom init` renders `install.sh`, a managed POSIX shell script. An operator runs it from the repository:

```sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/acme/notes/main/install.sh | sh
curl --proto '=https' --tlsv1.2 -fsSL https://raw.githubusercontent.com/acme/notes/main/install.sh | sh -s -- --dir /opt/notes/bin 1.4.0
```

It downloads the release asset for the platform from the repository's GitHub Releases, verifies it against the release's `SHA256SUMS`, moves it into place (`~/.local/bin` unless `--dir` names another folder), and writes the installation record, `install.json`, which self-update reads. `loom.config.json` may declare a `postInstall` command and message the script runs and prints. A release publishes each asset that `cargo loom build --release --target <triple>` wrote and the `SHA256SUMS` beside them. The script is the reference's byte for byte, and [docs/toolchain/install.md](../../../docs/toolchain/install.md) states the release shape it reads.

## Self-update

Feature `self-update`. `self_update()` adds the `self-update` Command and update notices:

- `app self-update` replaces the running binary with the newest release on its channel, or `app self-update <version>` with a named one, and `--check` reports what an update would do and downloads nothing. It acts only on a binary the installer script placed, still at the recorded path and with the recorded digest. It verifies the asset against the release's `SHA256SUMS`, renames it over the binary, rewrites `install.json`, and then calls the author's `after_replace` hook.
- After a run at a terminal, a notice names a newer release when the cache in the application's cache directory knows of one. A cache older than a day is refreshed by a detached copy of the application that the run never waits for. `NO_UPDATE_NOTIFIER`, the variable `notice_env` names, `CI`, and a stream that is not a terminal each turn the notice off, and `.notices(false)` turns it off for good.

Requests go to `https://github.com/` alone, with no credential and no API call, through `reqwest` over rustls. An application that installs completion, man pages, or skills passes their refresh to `after_replace`, so the new binary rewrites what the old one installed:

```rust
use loomcli_core::{Application, Context};
use loomcli_plugins::completion::{completion, refresh_completion};
use loomcli_plugins::self_update::self_update;
use loomcli_plugins::skills::{refresh_skills, skills};

let notes = Application::new("notes")
    .plugins((
        completion(),
        skills(Vec::new()).plugin(),
        self_update()
            .notice_env("NOTES_NO_UPDATE_NOTICE")
            .after_replace(|context| async move {
                refresh_completion(context.refresh()).await?;
                refresh_skills(context.refresh()).await
            })
            .plugin(),
    ))
    .description("Keep notes in sync.")
    .action(|context: Context| async move { context.out.print("notes").await });
loomcli_testing::assert_assembles(&notes);
```

## The service plugin

Feature `service`. `service(label, run)` runs one of the application's own Commands as a per-user service the platform supervises: a systemd user unit on Linux and a launchd user agent on macOS. `label` is the unit's reverse-DNS name, and `run` the words the unit runs the application with. The plugin adds the `service` Command group:

- `service install` writes the unit, records it in the installation record, loads it, and starts it. It is refused for a source or development build, which the service would outlive.
- `service uninstall`, `start`, `stop`, and `restart` act on the installed unit.
- `service status` reports the unit's state as a result with `text` and `json` views, plus the rows the author's `probe` adds.

The plugin never touches a file it did not record, and every graph build checks that the `run` words route to a Command with an action.

```rust
use loomcli_core::{Application, Command, Context, GroupApplication, RunOptions};
use loomcli_plugins::service::{ServiceDetail, service};
use loomcli_testing::{MockFields, mock_process};

fn notes() -> GroupApplication {
    Application::new("notes")
        .plugins((service("com.acme.notes", ["serve"]).probe(|probe| {
            Box::pin(async move {
                let health = if probe.state.running { "ok" } else { "down" };
                Ok(vec![ServiceDetail::new("health", health)])
            })
        }),))
        .description("Keep notes in sync.")
        .command(
            Command::new("serve")
                .description("Keep the notes in sync until stopped.")
                .action(|context: Context| async move { context.out.print("serving").await }),
        )
}

#[tokio::main(flavor = "current_thread")]
async fn main() {
    // The mock process reports a source build, which service install refuses.
    let process = mock_process(MockFields::new().argv(["service", "install"]));
    let code = notes().run(RunOptions::new().process(process.clone())).await;
    assert_eq!(code.get(), 1);
    assert_eq!(
        process.stderr_text(),
        "notes is a source build, so it cannot install a service that would outlive it. Build it with cargo loom build, then run the built notes service install.\n"
    );
}
```

Every call to `systemctl --user`, `loginctl`, and `launchctl` goes through `host.spawn`, so a test scripts those programs on the mock process with `MockFields::script`.
