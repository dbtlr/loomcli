---
type: adr
title: ADR-0211 - Update notices name the package manager's upgrade command
description: Core derives a Homebrew installation from a Cellar path, and an npm installation from npm's global root, when no installation record matches. The build bakes the npm package name, and loom build --target npm bakes it into each platform binary. The self-update plugin uses GitHub release facts to show notices that name the installer's command for the announced version, and gives the command for the version asked for when it refuses to replace a package-managed installation. A name outside an allow-list grammar gives no command.
status: proposed
created: 2026-11-19
modified: 2026-11-19
---

# ADR-0211 - Update notices name the package manager's upgrade command

## Context

[ADR-0071](0071-an-installation-record-per-application-says-how-it-was-installed-and-what-its-installers-wrote.md) lets core trust an installation record whose path resolves to the running binary. [ADR-0080](0080-the-self-update-plugin-tells-an-interactive-operator-about-a-newer-release-from-a-daily-cache.md) uses that record to show update notices only for a binary placed by the installer script. A Homebrew formula's install step is sandboxed to its prefix, and a global npm install can run with `--ignore-scripts`. Neither installation can depend on writing the application's per-user record. The installed application's path still gives core a way to identify the installer.

[ADR-0073](0073-the-self-update-plugin-replaces-a-script-installed-binary-with-a-verified-release.md) reserves replacement for a script-installed release binary whose bytes match the record. An operator of an application installed through a package manager can use the notice, and needs the package manager's command when self-update refuses.

## Decision

- **Read the application path.** During host capture for a build with a baked release group and no supplied `release`, core resolves the application's path through symbolic links first. It uses the executable path when the facts mark a compiled build or carry a release asset. Otherwise it uses the bundle's entry script path. The entry script is the same path that follows the runtime in `host.program`. Resolving the runtime's path for a bundle would identify the installation of Node or Bun. If the application has no path or that path cannot be resolved, the installation is absent. Core reports neither case.
- **Prefer the record.** For a release binary with an asset, core still checks the format-1 `install.json` under ADR-0071. A valid record whose path resolves to the same path as the executable wins, retaining its recorded `method`, `path`, and `digest` and nothing else. A missing directory, missing or unreadable record, malformed content, or path mismatch falls through to derivation. A release bundle can have a derived installation and reads no `install.json`.
- **Derive the method.** Match whole, case-sensitive directory components of the absolute realpath, using the running process's path rules and excluding the path root and the file name. Prefixes and suffixes of a component never match. The first layout that matches decides:
  1. **Homebrew.** A component `Cellar` followed by a formula directory and a version directory, with at least the application file below them, reads as `brew`. The component immediately after `Cellar` is the formula name. The version component need not be SemVer. If several `Cellar` components qualify, the one nearest the application file wins. A Homebrew formula that wraps an npm package installs it under its own keg, such as `Cellar/notes-cli/1.5.0/libexec/lib/node_modules/@acme/notes/`, so that path reads `brew`: Homebrew installed it, and `brew upgrade` updates it.
  2. **npm's global root.** The outermost `node_modules` component reads as `npm` only when the component before it is `lib`, so the path runs through `<prefix>/lib/node_modules`, the root `npm install -g` installs into on Linux and macOS. That covers a bundle in a global package, a scoped package, and the binary an npm launcher package starts from its platform package beneath the root. Any other `node_modules` layout derives nothing: a project's dependency, such as `~/code/app/node_modules/@acme/notes/`, a package `npx` runs from its cache, such as `~/.npm/_npx/<hash>/node_modules/`, and the global roots of pnpm, Bun, and Yarn, which have no `lib` before `node_modules`. On Windows, npm's global root is `<prefix>\node_modules`, which no component distinguishes from a project's `node_modules`, and [ADR-0100](0100-acceptance-plans-live-beside-the-tests.md) ships no Windows branch, so a Windows path derives nothing.
  3. **Anything else.** The installation is absent.
- **Report the evidence.** A derived installation carries `method` and the resolved application `path`. It carries no `digest`. A Homebrew installation also carries `formula` from the matching Cellar component. A matching record keeps its three recorded fields alone, whatever its method, because no Loom writer records `brew` and a record names no formula. Core writes no record and hashes no file during capture. The format still accepts any nonempty method string, so the public `method` stays `string` and now documents `brew` and `npm` beside `script`. The public `digest` and `formula` are optional strings. A supplied `release` still replaces the whole field and bypasses both lookups.
- **Bake the npm package name.** `loom build --release` takes the full `package.json` `name`, scope included, from the package it builds and bakes it as the optional `release.npmPackage` string. The same facts appear in `--facts` and `--define`. The name is independent of `--name` and of the executable or entry script basename. The build bakes it for every release target whose manifest has one, compile targets included, because one compiled release asset can reach operators through Homebrew, the installer script, or npm. For a binary that operators install from npm through a launcher package, `loom build --target npm`, which ADR-0213 proposes, compiles each platform binary with `release.npmPackage` set to the launcher package's name `<pkg>`, so the command names the package the operator installed and never a platform package. With no usable manifest name, the build omits the field. Older artifacts and custom builds may omit it too. Core preserves a present nonempty string and applies its existing malformed release-facts rule to other values.
- **Judge each name by an allow-list.** A name enters a command only when it matches its grammar, so a command never needs quoting:
  - **A formula name** is one or more of the lowercase letters `a` to `z`, the digits, `+`, `-`, `.`, `@`, and `_`, starting with a letter or a digit, such as `notes-cli`, `notes@2`, or `gtk+3`.
  - **An npm package name** is at most 214 characters. It is an unscoped segment, or `@`, a segment, `/`, and a segment, such as `notes` or `@acme/notes`. A segment is one or more of the lowercase letters `a` to `z`, the digits, `-`, `.`, and `_`, starting with a letter or a digit. The name is never `node_modules` or `favicon.ico`, the whole names npm reserves. `@loomcli/core` exports this rule as `isNpmPackageName`, so the plugin and `loom build --target npm`, which ADR-0213 proposes, judge a name by one rule.

  A name outside its grammar gives no command, as a missing one does. Every character the grammars allow is literal in a POSIX shell word, so `brew upgrade <formula>` and `npm install -g <pkg>@<version>` paste as they print. The messages module still passes each name through `escapeControlCharacters` under [ADR-0164](0164-looms-operator-messages-live-in-message-modules-and-a-voice-test-per-package-reads-them.md), which leaves a valid name unchanged.
- **Choose one command.** A script installation with a release asset and a recorded digest gives `<app> self-update`. A Homebrew installation with a valid formula name gives `brew upgrade <formula>`. An npm installation with a valid baked package name gives `npm install -g <pkg>@<version>`, scope included, where `<version>` is fixed by the message that names the command. The notice and the refusal share these rules and read the same installation: a matching script record whose realpath is in a Cellar or npm's global root reads as that package manager's installation for both, so the notice never names `self-update` for a binary the Command would refuse to replace. A run whose installation gives no command shows no notice.
- **Word the notices.** The self-update messages module words every notice. The notice names the announced version, the cached `latest`, in the npm command, so a notice tells the operator the exact install that reaches the version it announces:

  | Installation | Template | Example |
  | --- | --- | --- |
  | script | `<app> <latest> is available on the <channel> channel. Run <app> self-update to update from <version>.` | `notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.` |
  | `brew` | `<app> <latest> is available on the <channel> channel. Run brew upgrade <formula> to update from <version>.` | `notes 1.5.1 is available on the stable channel. Run brew upgrade notes-cli to update from 1.5.0.` |
  | `npm` | `<app> <latest> is available on the <channel> channel. Run npm install -g <pkg>@<latest> to update from <version>.` | `notes 1.5.1 is available on the stable channel. Run npm install -g @acme/notes@1.5.1 to update from 1.5.0.` |
  | `npm`, a prerelease | the same | `notes 1.6.0-next.2 is available on the next channel. Run npm install -g @acme/notes@1.6.0-next.2 to update from 1.6.0-next.1.` |

  Homebrew keeps `brew upgrade <formula>`, because a formula installs only its current version.
- **Word the skipped checks.** At `-vv`, [ADR-0165](0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md)'s `Skipped the update check: <reason>` names the first condition that fails. The middleware's release condition becomes three conditions, in this order, and their reasons replace ADR-0165's `<name> is not a release binary.` and `<name> was not installed by install.sh.`:

  | Condition that fails | Reason template | Example line |
  | --- | --- | --- |
  | The run has no release group. | `{name} is not a release build.` | `Skipped the update check: notes is not a release build.` |
  | The run has no installation. | `{name} was not installed by install.sh, Homebrew, or npm.` | `Skipped the update check: notes was not installed by install.sh, Homebrew, or npm.` |
  | The installation gives no command. | `{name} was installed by {method}, and its facts give no upgrade command.` | `Skipped the update check: notes was installed by npm, and its facts give no upgrade command.` |

  `{method}` is the installation's method as core holds it, escaped. The first reason drops the word `binary`, because a release bundle now passes it.
- **Use GitHub for notices.** A notice reads a release group's version, channel, and repository. The Homebrew and npm cases need a command and can use a release group without an asset. The script case keeps its binary asset requirement. The cache, its comparison by release channel and SemVer precedence, and the detached refresh keep the GitHub release lookup. The refresh needs a release group and can run without an asset or installation. An npm-only application with no GitHub releases has no newer GitHub release to announce. The lookup does not query the npm registry or confirm availability through either package manager.
- **Refuse replacement.** After usage checks and before any asset, installation directory, or digest checks, ordinary `self-update`, including `--check`, refuses a Homebrew or npm installation with exit 1, makes no request, and changes no files. A matching script record still supplies the host facts. Before permitting replacement, the Command independently applies core's package-manager path rules to the realpath of the recorded path, through `packageManagerInstallation` from `@loomcli/core`. If the file or a parent directory is a symbolic link into a package-managed layout, the Command gives the same package-manager refusal. The npm command names the version the run asked for:

  | The run | The sentence |
  | --- | --- |
  | `self-update` on a Homebrew installation, with or without a version | `notes was installed with Homebrew, so self-update cannot replace it. Run brew upgrade notes-cli.` |
  | `self-update 1.4.2` or `self-update v1.4.2` on an npm installation | `notes was installed with npm, so self-update cannot replace it. Run npm install -g @acme/notes@1.4.2.` |
  | `self-update --channel next` on an npm installation | `notes was installed with npm, so self-update cannot replace it. Run npm install -g @acme/notes@next.` |
  | Plain `self-update` on an npm installation running on `next` | `notes was installed with npm, so self-update cannot replace it. Run npm install -g @acme/notes@next.` |
  | Plain `self-update` on a stable npm installation, or `self-update --channel stable` | `notes was installed with npm, so self-update cannot replace it. Run npm install -g @acme/notes@latest.` |
  | either installation without a command | `notes was installed with Homebrew, so self-update cannot replace it. Update it with Homebrew.`, or the same with `npm` |

  A named version drops its leading `v`. Without a version, the Command follows the requested channel or the running application's channel under [ADR-0073](0073-the-self-update-plugin-replaces-a-script-installed-binary-with-a-verified-release.md). The stable channel uses `latest`. Publishing npm prereleases by channel under ADR-0213 requires a channel name npm accepts as a dist-tag. If npm reads the channel as a SemVer range, such as `0`, `x`, or `v1`, the refusal gives only `Update it with npm.` Replacement still requires the recorded script installation and its digest.

This record supersedes ADR-0080's script-only notice gate and its single command, and replaces two of ADR-0165's skip reasons. It narrows ADR-0073's replacement, which gains the early package-manager refusal and the ownership check of the recorded path. It extends ADR-0071's installation read and [ADR-0065](0065-release-facts-on-the-host-say-how-the-running-application-was-built.md)'s release and installation groups. [Installation record](../core/installation-record.md#reading-the-installation), [Release facts](../core/release-facts.md), and [Self-update](../plugins/self-update.md#update-notices) state the resulting contract.

## Considered options

- **Have Homebrew and npm write the record.** A Homebrew formula cannot depend on writing outside its prefix. An npm install can skip lifecycle scripts. The path is available to a run in either case.
- **Bake the installation method.** A single compiled release asset can go through the installer script, Homebrew, or an npm launcher. Only its installed path or matching record can distinguish them.
- **Read every `node_modules` ancestor as `npm`.** The draft of this record did. A project dependency, a package `npx` runs from its cache, and a pnpm, Bun, or Yarn global install all sit under `node_modules`, and `npm install -g` is the wrong command for each: it installs a second, global copy and leaves the one that ran unchanged, so the notice would repeat forever. Only npm's global root makes `npm install -g` the right command. pnpm, Bun, and Yarn global roots each have their own command and are left for a later record.
- **Take the npm package name from the path or from the Application name.** The path can name a platform package whose binary an npm launcher uses, and stripping the platform suffix would be a second naming rule beside the baked one. The Application name can be different from the scoped package the operator upgrades. The baked `release.npmPackage` is the one rule.
- **`@latest` in every npm notice.** The draft of this record did. On a prerelease channel, `@latest` installs the newest stable version, so the notice for `1.6.0-next.2` would move the operator off the channel it announces, and the notice would then repeat. The exact version installs what the notice names on every channel.
- **Quote a name that the shell would read specially.** A quoted name pastes correctly in one shell family and wrongly in another. The allow-list keeps every command one plain word per argument, and a package or formula name outside it is one npm and Homebrew no longer accept for new names.
- **A separate optional group for derived installations.** Core could leave `installation` as the record alone, with its `digest` required, and put a derived Homebrew or npm installation in a new optional group, such as `host.release.packageManager`. Nothing an author reads today would change, so the change would be a feature. It was not taken under the fragment guide's [Break no more than a change needs, and no less](../../.changes/README.md): the installation is one fact, how the running application was installed, and two groups would give it two answers that every reader combines, the version plugin's extended output and self-update included. A derived installation is that same fact with weaker evidence, and an optional `digest` states that honestly in the type. The break is the smaller one that keeps one answer.
- **Read the npm registry for npm installations.** The existing lookup and cache answer whether there is a newer GitHub release. Registry versions and dist-tags need their own source and policy.
- **Hash the file or put a placeholder in `digest`.** The digest in a record describes the bytes the installer verified. The current file's digest or a placeholder cannot provide that evidence.

## Consequences

Release capture resolves the application path even when there is no record. The path identifies the installer for update guidance. Only the script installer's recorded digest can authorize replacement by self-update.

A project or workspace directory named `lib` that contains `node_modules`, such as `~/code/lib/node_modules/@acme/notes/`, matches npm's global layout. The notice then names `npm install -g`, which installs a second copy globally. The path alone cannot distinguish this layout from an npm global root, and there is no cheap check to distinguish them.

The refresh keeps the existing prerelease lookup, which checks candidate releases for `SHA256SUMS`. A GitHub release that lacks that asset is passed over by that lookup.

A notice fires once the GitHub release exists, which comes before the package manager has it. Until the formula is bumped or the npm publish of that version finishes, the notice's command fails or reports that nothing is newer: `brew upgrade notes-cli` says the formula is already up to date, and `npm install -g @acme/notes@1.5.1` fails because no such version exists yet. The notice repeats on every qualifying run until the operator's installation reaches the version. The lag lasts as long as the author's release workflow takes to publish to the package manager, which Loom does not see.

The exact npm version fixes the prerelease case. A `next` operator's notice names `@acme/notes@1.6.0-next.2`, which installs that prerelease. `@latest` would have installed the newest stable version and left the operator off the channel the notice announced.

`ReleaseFacts` is a public type that callers can also supply through process handles. Adding an optional package name or formula is compatible. The new installation method values already fit the public `string` type. The change breaks two things:

- **The type.** Making the digest optional widens a value authors read from `string` to `string | undefined`. Authors who rely on a digest check for one before using it.
- **The runtime.** `installation` is now present for Homebrew and npm runs, where it was absent before. Code that reads its presence as "installed by the script", such as code that offers its own update path when an installation is present, now takes that path for a Homebrew or npm run. Such code reads `installation.method` or `installation.digest` instead. The [installation record](../core/installation-record.md) example shows the check.

The implementation therefore carries a `breaking.` fragment that names both breaks, with migration steps under the [fragment guide](../../.changes/README.md). It regenerates and commits the public API report with `pnpm check:api --update` and verifies it with `pnpm check:api`. [Public exports](../core/public-exports.md) defines the report contract.

The acceptance plans live beside the [installation](../../packages/plugins/tests/installed-files.test.ts), [notices](../../packages/plugins/tests/update-notices.test.ts), [replacement](../../packages/plugins/tests/self-update.test.ts), and [build](../../packages/loom/tests/build.test.ts) tests.

## Status

Proposed. It moves to accepted in the release PR of the release that ships it.

## Changelog

- 2026-11-19: Proposed for package-manager update notices (LM-398).
- 2026-11-19: Revised after the contract review (LM-398). npm is derived only from npm's global root, `<prefix>/lib/node_modules`, and any other `node_modules` layout derives nothing. The npm command names the exact version, and the refusal names the version or channel asked for. Names pass an allow-list grammar. The notice and `-vv` sentences are given. `loom build --target npm` bakes the launcher's package name into each platform binary. A matching record carries no formula. The runtime break, the package-manager lag, and the separate group for derived installations are stated.
- 2026-11-19: The npm refusal for plain `self-update` follows the running application's release channel. The stable channel uses `latest`.
- 2026-11-19: Recorded the limit for project and workspace directories literally named `lib` that hold `node_modules`.
- 2026-11-19: After implementation review, self-update checks the script record's realpath for package-manager ownership through `packageManagerInstallation`, a new `@loomcli/core` export that applies core's Cellar and npm global-root rules to an absolute realpath. The npm refusal names only the manager when the channel cannot be used as a dist-tag.
- 2026-11-19: After the milestone review, the npm package name rule moves to `@loomcli/core` as `isNpmPackageName`, a new export, so `loom build --target npm` checks the manifest name by the rule the plugin reads `npmPackage` by. ADR-0073 carries a dated entry for the early refusal and the ownership check of the recorded path.
