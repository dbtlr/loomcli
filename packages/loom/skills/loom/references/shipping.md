# Shipping a Loom application

This reference covers how to build, release, install, and update a Loom application, and which of those steps the author's own repository keeps.

## Pick the build target

`loom build` builds one target per call, under [loom build](../../../../../docs/toolchain/build.md#loom-build).

- **Name the target.** Without `--target`, the build compiles a binary for the host.
- **`node`** writes a JavaScript bundle: `main.js` from the entry, `application.js` from the application module, and their shared chunks. Pick it to publish to npm for operators who have Node, as the scaffold's `bin` and `build` script do. The package manager then owns updates, and self-update refuses such an install.
- **`bun`** writes the same bundle for Bun. Pick it only when the application needs Bun when it runs.
- **A compile target**, `bun-<os>-<arch>` with `-musl` on Linux, compiles a single binary that needs no runtime on the operator's machine. It is the only kind of build that `install.sh` and self-update serve. One host can compile every target. A `-baseline` or `-modern` x64 build compiles, but neither `install.sh` nor self-update fetches it.
- **Ship a distributed build.** `--build distributed` is the default. A [development build](../../../../../docs/core/release-facts.md#development-builds), such as one `--watch` writes, shows each defect's Developer Diagnostic, and a distributed one prints `<name>: Something went wrong.` instead. `service install` refuses any build that is not distributed.
- **Build through `loom build`.** A bundle built without the `__LOOM_RELEASE__` define reads as a source run, so it shows the author's detail to operators and carries no release facts. When you need another bundler, pass it the value `loom build --define` prints. Such a build carries no skills folder.
- **Ship the whole output.** A bundle includes its dependencies, `@loomcli/core` among them. A distributed bundle whose application names a skills folder also writes `loom-skills/` beside its chunks, so publish the output directory whole.

## Bake the release facts

- **Build release binaries with `--release`.** It bakes `version` from `package.json`, `repository` as `owner/name` from the `repository` field or `--repository`, and, for a compile target alone, `asset`, which is `<name>-<platform>`, such as `notes-linux-x64-musl`. Core reads the installation record only for a binary whose facts carry an `asset`, so without `--release` self-update refuses and update notices stay silent.
- **The release channel comes from the version.** Core reads the channel as the first prerelease identifier, so `1.5.0-next.2` is on `next`, and a version without one is on `stable`. Choose prerelease identifiers as the channel names operators follow with `self-update --channel <channel>`.
- **Read the facts from the host.** An action reads `host.release`, and a test supplies facts through its process handle, under [release facts](../../../../../docs/core/release-facts.md). Never import or pass them yourself.
- **Make `--version` agree.** The version plugin prints the Application's declared `version`, which is `0.0.0` unless the Application sets one, while self-update and update notices compare `host.release.version`, the `package.json` version. Set the Application's `version` from `package.json`, such as through a JSON import, so the two agree.

## Keep one name

The application's name appears four times, and the four must match:

- the Application's name, under which core reads the [installation record](../../../../../docs/core/installation-record.md);
- the `bin` key in `package.json`, which `loom build` names the binary and its asset after, unless `--name` overrides it;
- the asset prefix, which `install.sh` and self-update download;
- the name `loom init` renders into `install.sh`, under which the script writes `install.json`.

When the Application's name differs from the `bin` key, a binary that `install.sh` installed finds no installation, and self-update reports that it was installed some other way. Keep `bin` an object with one key equal to the Application's name, as the scaffold writes it.

## Cut the version from fragments

- Add a change fragment for each consumer-visible change, and run `loom changelog check` in CI.
- Cut with `loom changelog write` before you build a release, because `--release` bakes the `package.json` version, and the release tag is `v<version>`.
- Print the release page's body with `loom changelog notes <version>`.
- A prerelease cut, `loom changelog write --target 1.5.0-next.1`, sets the version and keeps the fragments pending until the stable cut.
- One cut can set several binaries' versions through `sharedVersion`, so they ship from one tag.
- Follow the loom-changelog skill, at `.agents/skills/loom-changelog/SKILL.md`, for the steps, and the [changelog reference](../../../../../docs/toolchain/changelog.md) for the rules.

## Publish the release shape

`install.sh` and self-update read one [release shape](../../../../../docs/toolchain/install.md#the-release-shape), which your release workflow publishes. A workflow for version 1.4.0 of `notes`, run after the cut is committed, looks like this:

```sh
for platform in darwin-arm64 linux-x64 linux-arm64 linux-x64-musl linux-arm64-musl; do
  npx loom build --release --target "bun-$platform" --out "dist/notes-$platform"
done
(cd dist && sha256sum notes-* > SHA256SUMS)
gh release create v1.4.0 dist/notes-* dist/SHA256SUMS --notes "$(npx loom changelog notes 1.4.0)"
```

- **Name each file for its asset.** A binary's default output is `dist/<name>`, so each call would overwrite the last. The uploaded file's name must be the asset the binary baked, because self-update requests that name.
- **List every asset in `SHA256SUMS`.** A release without the file, or without a line for an asset, installs nothing.
- **Mark what is not the latest stable.** Publish a prerelease version as a GitHub prerelease, and an older line's release with `--latest=false`, so `releases/latest` stays the highest stable version.
- **Publish the platforms you support.** An operator on a platform the release lacks, such as a musl Linux without a `-musl` asset, cannot install.

## Install with install.sh

- **It needs a GitHub repository.** `loom init` renders the [installer script](../../../../../docs/toolchain/install.md) only when the `package.json` `repository` names GitHub. Otherwise it warns and writes none. Set `repository`, then run `loom init --only install`.
- **Commit it and serve it.** Give operators its raw URL to pipe into `sh`. A monorepo places it with `paths.installer`, such as at the repository root.
- **What it installs.** With no version argument, it installs the latest stable release into `$HOME/.local/bin`, never a prerelease. It verifies the asset against `SHA256SUMS` and then writes `install.json` with the method `script`, which is what lets self-update replace the binary later.
- **It is a managed file.** Do not edit it. A re-run of init re-renders it for the installed toolchain.

## Run after install

- **Declare it in `loom.config.json`.** `postInstall.command` is the argument words the script runs the installed binary with, such as `["setup"]`, and `postInstall.message` is the text it prints last, under [the post-install command](../../../../../docs/toolchain/install.md#the-post-install-command). Init renders both into `install.sh` without loading the application, so run `loom init` again after changing them.
- **Nothing checks the words.** Words that route to no Command fail on the operator's install, so run them against a built binary before you release.
- **It is not fatal.** A failing command prints how to run it again, and the install still succeeds. An operator can skip it with `--skip-post-install`.
- **Self-update never runs it.** Do work that must follow an update in `afterReplace`.
- **Keep what it records in a file of your own.** Write it in the directory `applicationDirectory('installation', name, host)` gives, under a name no Loom writer uses, such as `<name>.json`. Self-update leaves that file in place. Never write `install.json` or a plugin's file, such as `service.json`.

## Update in place

`selfUpdate()` from `@loomcli/plugins/self-update` adds the `self-update` Command and, unless `notices: false`, update notices, under [the self-update plugin](../../../../../docs/plugins/self-update.md).

- **It replaces only what `install.sh` placed.** The binary must be a compile target built with `--release`, installed by the script, and unchanged since. A binary built or installed any other way draws `Update it the way you installed it.`, and a changed one says to install it again with `install.sh`.
- **A root that declares arguments cannot install it.**
- **`afterReplace` runs the old code.** The hook runs in the replaced process, so anything that needs the new version runs the binary at `path`. The completion, man page, and skills plugins each export a refresh that does this. Compose them in one hook:

```ts
import { Application } from "@loomcli/core";
import { completion, refreshCompletion } from "@loomcli/plugins/completion";
import { manpage, refreshManpages } from "@loomcli/plugins/manpage";
import { selfUpdate } from "@loomcli/plugins/self-update";

export const notes = new Application("notes", {
  description: "Keep notes.",
  plugins: [
    completion(),
    manpage(),
    selfUpdate({
      afterReplace: async (context) => {
        await refreshCompletion(context);
        await refreshManpages(context);
      },
    }),
  ],
});
```

- **Restart a service unit after a replace.** A [service unit](../../../../../docs/plugins/service.md) runs `host.program` and keeps the replaced process running, so run `path` with `service restart` from `afterReplace`. The unit runs the copy that installed it, so install the service from the installed binary.
- **A failing hook fails the run after the update line.** The new binary and its record stay.

## What your repository keeps

Loom ships no release workflow, and init writes none. Your repository owns:

- when to cut, and the commit of the cut with the refreshed lockfile;
- the build matrix, `SHA256SUMS`, the tag, and the GitHub Release;
- publishing to npm, and any PR guards;
- where operators fetch `install.sh` from.
