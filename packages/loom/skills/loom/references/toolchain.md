# The loom toolchain

This reference covers the `loom` bin: how to run it, when to run each command, what it reads, which files `loom init` owns, and what the toolchain leaves to the author.

## Run the bin from the package

- `@loomcli/loom` is a development dependency. The application's runtime never imports it, so never add it to `dependencies`.
- Inside a package that has it installed, run the bin through the package manager, such as `pnpm exec loom build`, `npx loom changelog check`, or a `package.json` script. This skill writes the bin as `loom`.
- In a directory with nothing installed yet, run init through the package runner, such as `bunx @loomcli/loom init`. Init installs nothing, so run the package manager's install after it.
- Keep every `@loomcli/*` package at one version. Init pins `@loomcli/core`, `@loomcli/loom`, `@loomcli/testing`, and `@loomcli/eslint-plugin` at the exact version of the `loom` that ran, so add `@loomcli/plugins` and `@loomcli/validators` at that version too. A `loom build` that cannot read the skills declarations of the installed `@loomcli/plugins` fails and says to install the two at one version.
- `loom build` runs Bun whichever runtime runs `loom`, so Bun must be on the `PATH`. Init also loads an existing application module under Bun when it writes a missing entry or test.
- `loom changelog write`, and `loom changelog notes` for a prerelease, order entries by git history, so run them in a clone with full history, not a shallow CI checkout.
- There is no `loom check`. The package's `check` script, which runs `tsc --noEmit`, the linter, and the test runner, and the [assembly check](../../../../../docs/libs/testing.md#assertassembles) test that init writes take its place. Keep that test, because it is what fails CI when the assembled application has a fault.
- The bin has hidden commands. They are the Loom repository's own release tooling, so never run them or copy them into a workflow.

## Choose the command

- `loom init`: to start an application in an empty directory or add the pieces a package lacks, and again after you upgrade `@loomcli/loom` or change `loom.config.json` or the `package.json` `repository`, so the managed files follow.
- `loom init --only <piece>`: to write only some pieces, such as `--only install` after you set `repository`, or `--only skill` to refresh both skills.
- `loom build --target node`: to build the bundle the scaffold's `bin` and `build` script name.
- `loom build --target bun-<os>-<arch> --release`: to build a release binary, under [shipping](shipping.md).
- `loom build --watch --target node`: to rebuild a development artifact on each change while you work.
- `loom build --define` or `--facts`: to compose the same release facts into another bundler's call. It builds nothing.
- `loom changelog check`: after you write a change fragment, and in CI on every change.
- `loom changelog write`: to cut a version or a prerelease from the pending fragments.
- `loom changelog notes <version>`: to print a version's release notes for its release page.

Across the commands:

- Name `--target` on every `loom build`. The flag is optional, but without it the build compiles a binary for the host rather than the bundle the scaffold's `bin` and `build` script name, so naming the target keeps a build from changing with the machine it runs on.
- Follow the loom-changelog skill, at `.agents/skills/loom-changelog/SKILL.md`, for fragments and cuts. The [changelog reference](../../../../../docs/toolchain/changelog.md) holds every rule.
- Exit code 1 is a failed build, check, or cut, and 2 is a command or option error.

## What the bin reads

- **One package.** Every command acts on the [package directory](../../../../../docs/toolchain/build.md#one-package-directory), the directory of the nearest `package.json` at or above the working directory. It never acts on a repository as a set of packages. In a monorepo, run the command in each package, or let the monorepo's own tool do it. At a monorepo root, it acts on the root's own `package.json`.
- **Where a value comes from.** A command option beats `loom.config.json`, and the file beats the convention. The rest comes from standard `package.json` fields: `name`, `version`, `bin`, and `repository`.
- **The toolchain configuration file.** `loom.config.json` sits beside `package.json` and is optional. Init never writes one, so add it only to depart from a convention. Its keys are `paths` (`source`, `application`, `entry`, `out`, `changes`, `changelog`, `installer`), `sharedVersion`, and `postInstall`, as the [configuration file](../../../../../docs/toolchain/build.md#the-configuration-file) table states. Every path resolves against the package directory, wherever the file sits.
- **A rejected value is dropped.** A value the file's schema rejects is dropped and its convention applies, with no error. Run the command with `-v` to see which value was dropped. `sharedVersion` is the exception: a malformed list fails the cut. `--no-config` reads no file, so CI can check that the package also builds on conventions.
- **What the file never moves.** `package.json`, `tsconfig.json`, the linter's configuration, `bunfig.toml`, and both agent skills stay where other tools look for them. The file has no skills key: the skills plugin's `folder` setting names the [skills folder](../../../../../docs/toolchain/build.md#the-skills-folder), and `loom build` reads it from the application module.
- **The application's name.** It is the key of a `bin` object with one key. Without one, `loom init` falls back to the package name without its scope, and `loom build` does so only for a string `bin`, or takes `--name`. Keep `bin` an object whose one key is the Application's name, as the scaffold writes it, because the binary, the release asset, and the installer script all take their name from it.

## Scaffold files and managed files

`loom init` writes two sorts of files, under [loom init](../../../../../docs/toolchain/init.md).

- **Scaffold files are yours.** `src/application.ts`, `src/main.ts`, `src/application.test.ts`, `tsconfig.json`, the lint configuration, and the `package.json` keys are written only when missing, and never overwritten or tracked. Edit them freely.
- **A re-run fills gaps at the configured paths.** Init writes any scaffold file that is missing where the configuration places it. A package that keeps its Application somewhere else sets `paths.application`, `paths.entry`, or `paths.source` first, or limits init with `--only`, or init writes a second application at `src/application.ts`.
- **Init never changes a `package.json` key.** A re-run does not upgrade dependencies or rewrite scripts. Upgrade the `@loomcli/*` packages together with the package manager, then run `loom init` to refresh the managed files.
- **Managed files are Loom's.** The fragment guide, `<changes>/README.md`, the changelog skill, this skill at `.agents/skills/loom/`, and `install.sh` carry a header with a checksum. A re-run re-renders each file whose checksum still matches, so an unedited file follows the installed toolchain. Commit them.
- **Do not edit a managed file.** An edited file has drifted: each init run that writes its piece warns about it and leaves it alone, and `--force` restores it. To keep your own version, delete its header, and init never writes it again. Put project-specific agent instructions in a file of your own instead, so this skill keeps refreshing.
- **Stale skill files go.** A file under `.agents/skills/loom/` that carries the header, matches its checksum, and is no longer rendered by the installed `loom` is removed by the next run that writes the skills: a plain `loom init` or `loom init --only skill`. An edited one stays, with a warning, until `--force`.
- **`--force` never touches a scaffold file.**

## What the toolchain leaves to you

- **Your project layout.** Beyond the paths `loom.config.json` names, the toolchain does not adapt to how a project is laid out. For example, the `check` script runs `tsc --noEmit` against the package's `tsconfig.json`, so a solution-style configuration with `"files": []` and `references` checks no files and passes. Keep one `tsconfig.json` that includes the source.
- **Release orchestration.** PR guards, publishing to npm or GitHub, tags, release workflows, and acting on several packages stay with your repository. Init writes no workflow. [Shipping](shipping.md) states what a release workflow must publish.
- **The lockfile.** A cut sets versions and refreshes no lockfile, so run the package manager's install after it.
- **Windows.** `loom build` offers no `bun-windows-*` target, and `install.sh` does not run on Windows. An author who wants a Windows binary calls `bun build --compile` directly, as [loom build](../../../../../docs/toolchain/build.md#loom-build) states.
