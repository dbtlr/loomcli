---
description: "The self-update plugin: updating an installed application and update notices."
---

# Self-update plugin

This page documents the self-update plugin, which replaces an installed application's binary with a verified release, and the update notices it can print. An author installs it so an operator can update the application in place.

```ts sketch
// @loomcli/plugins/self-update
import type { Host, Log, Plugin } from '@loomcli/core';

export interface AfterReplaceContext {
  readonly previous: string; // the version that was replaced
  readonly current: string; // the version now at path
  readonly path: string; // the recorded path, as install.json holds it
  readonly name: string; // the application's name, as the graph holds it
  readonly host: Host; // the run's host, whose release facts still describe the replaced binary
  readonly signal: AbortSignal; // the run signal
  readonly log: Log; // the run's log, through which a hook logs what it did
}
/** A value only attestation() in @loomcli/plugins/self-update/attestation makes; members other than workflow are internal. */
export interface AttestationSetting {
  readonly [attestationSetting]: true; // attestationSetting is an unexported unique symbol, so an object literal cannot supply it
  readonly workflow: string; // the attesting workflow's path, as attestation() was given it
}
export interface NoticeSettings {
  /** A variable that turns notices off when it is set and not empty, beside NO_UPDATE_NOTIFIER. */
  readonly env?: string;
}
export interface SelfUpdateSettings {
  /** Called once after the binary is replaced and the record rewritten. */
  readonly afterReplace?: (context: AfterReplaceContext) => Promise<void> | void;
  /** Verify a GitHub artifact attestation of the asset before it is downloaded. */
  readonly attestation?: AttestationSetting;
  /** Update notices: on unless false. */
  readonly notices?: boolean | NoticeSettings;
}
export declare function selfUpdate(settings?: SelfUpdateSettings): Plugin;
```

```ts
import { Application } from '@loomcli/core';
import { help } from '@loomcli/plugins/help';
import { selfUpdate } from '@loomcli/plugins/self-update';

export const notes = (restartService: (path: string) => Promise<void>) => new Application('notes', {
  plugins: [help(), selfUpdate({ afterReplace: ({ path }) => restartService(path) })],
});
```

```text
$ notes self-update
Downloading notes-linux-x64 from v1.5.0 of acme/notes.
Updated notes from 1.4.2 to 1.5.0.
$ notes self-update --check
notes can update from 1.5.0 to 1.5.1 on the stable channel.
$ notes self-update --channel next
Downloading notes-linux-x64 from v1.6.0-next.2 of acme/notes.
Updated notes from 1.5.0 to 1.6.0-next.2.
$ notes self-update 1.5.0
Downloading notes-linux-x64 from v1.5.0 of acme/notes.
Updated notes from 1.6.0-next.2 to 1.5.0.
```

`selfUpdate()` is the self-update plugin. It replaces the running binary with a verified release from the application's GitHub repository, and only when the [installer script](../toolchain/install.md) placed the binary and nothing has changed it since. Its identity is `@loomcli/plugins/self-update`, and it contributes one [plugin Command](../core/plugin-contract.md#plugin-commands) and, unless the author turns them off, the middleware of [update notices](#update-notices). [ADR-0073](../decisions/0073-the-self-update-plugin-replaces-a-script-installed-binary-with-a-verified-release.md) records the decision.

- **Settings.** The settings type bounds `afterReplace`, `attestation`, and `notices`, and `selfUpdate()` judges `notices.env` at the call, as [Update notices](#update-notices) states, and `attestation`, as [Attestation](#attestation) states.
- **The Command.** `self-update`, visible, with the description `Replace this application with another release.`, the optional argument `version`, `A release version to install, newer or older, such as 1.4.0.`, the string option `--channel`, `The release channel to follow, such as stable or next.`, the Boolean option `--check`, `Report what an update would do and replace nothing.`, and the hidden Boolean option `--refresh-notice`, `Refresh the update notices' cache.`, which [update notices](#update-notices) runs. It declares no result. A version may carry a leading `v` and must otherwise be a semantic version, and a channel must be `stable` or a SemVer prerelease identifier, the set a version's derived channel comes from; each is judged by its input's validator, so a malformed one is core's usage error for that input, with exit 2. `--channel` beside a version is an `InputError` the action throws, `Option "--channel" cannot be given with a version. Leave out --channel, or the version.`, with exit 2. A root that declares arguments holds the plugin's Commands like any children, so such an application can install the plugin, as [completion](completion.md) does.
- **Refusals.** After usage checks and before any request, in this order, the Command fails with a `FatalError` and exit 1, replacing nothing and writing no record, when:

  | The run | The sentence and correction |
  | --- | --- |
  | has a Homebrew installation or a script record whose realpath is in a Homebrew Cellar | `notes was installed with Homebrew, so self-update cannot replace it. Run brew upgrade notes-cli.` |
  | has a global npm installation or a script record whose realpath is in npm's global root | `notes was installed with npm, so self-update cannot replace it. Run npm install -g @acme/notes@1.4.2.` for `self-update 1.4.2`, `@next` in place of the version for `self-update --channel next` or plain `self-update` on `next`, and `@latest` for plain `self-update` on stable or for `--channel stable` |
  | has no release group with an `asset` in `host.release` | `notes was not built as a release binary, so it cannot update itself. Update it the way you installed it.` |
  | cannot resolve the installation record's directory, because `applicationDirectory` answers `{ variable }` | `notes cannot find its installation record because HOME is not an absolute path. Set HOME to an absolute path, then run self-update again.`, naming the variable the lookup answers |
  | has no `installation`, or one whose method is not `script` | `notes was installed some other way, so self-update cannot replace it. Update it the way you installed it.` |
  | finds nothing at the recorded path, or something other than a regular file or a symbolic link | `notes cannot find its binary at /home/me/.local/bin/notes. Install it again with install.sh.` |
  | finds a symbolic link at the recorded path | `notes at /home/me/.local/bin/notes is a symbolic link, so self-update will not replace what it points to. Install it again with install.sh.` |
  | finds a file whose SHA-256 digest differs from the recorded one | `notes at /home/me/.local/bin/notes changed since it was installed, so self-update will not replace it. Install it again with install.sh.` |
  | cannot write to the recorded path's directory or the installation record's | `notes cannot write to /home/me/.local/bin. Run self-update as the user who installed notes.` |

  The package-manager refusals follow [The upgrade command](#update-notices) of update notices. The npm refusal names the requested version without its leading `v`. Without a version, it uses the channel from `--channel` or the running application's channel when the option is absent. The stable channel uses `latest`. Publishing npm prereleases by channel requires a channel name npm accepts as a dist-tag. npm rejects names that are SemVer ranges, such as `0`, `x`, and `v1`. If the channel cannot be used as a dist-tag, the correction is `Update it with npm.` An unusable package or formula name also gives a correction that names only the manager. A Homebrew formula installs only its current version, so the Homebrew command always takes the same form. The refusals also apply to `--check`.

  A matching script record still supplies the host facts. For the package-manager refusal, the Command resolves `installation.path` through symbolic links and applies core's package-manager path rules to the realpath. If the path passes that check, the Command follows links in the path's parent directories and refuses a link at the recorded file itself. The Command hashes the binary when it reaches verification of a recorded regular file, including on `--check`. Every path, URL, and version a message repeats passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition).
- **Requests.** Every request starts at an HTTPS URL on `https://github.com/`, except the requests [Attestation](#attestation) adds when the author sets it, which start at `https://api.github.com/`, at the bundle URLs GitHub's API answers with, and, through sigstore-js, at `https://tuf-repo-cdn.sigstore.dev`. Each request the Command makes itself follows each redirect itself, at most 20 for one request, and only to a URL whose scheme is `https:`. The Command sends no token and calls no API, apart from those added requests. It adds no time limit and no size limit, and every request the Command makes itself reads the run signal. The TUF requests that sigstore-js makes for [Attestation](#attestation) do not: when the run signal aborts, the Command stops waiting for them, while sigstore-js may go on fetching and writing its cache until its own limit ends them, as that section states. These responses fail the run with exit 1:

  | The response | The sentence and correction |
  | --- | --- |
  | a redirect to a scheme other than `https:` | `notes was redirected away from HTTPS while downloading https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64. Run self-update again later.` |
  | a 21st redirect | `notes was redirected too many times while downloading https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64. Run self-update again later.` |
  | a status other than `200` at the end of the redirects, or no response at all | `notes could not download https://github.com/acme/notes/releases/download/v1.5.0/notes-linux-x64 (503). Run self-update again later.`, with `(no response)` when none arrived or the body ended before it was whole, and for a `404` of a named version's `SHA256SUMS` or asset the correction `Check that release v1.4.0 exists, then run self-update again.` |

  A rejection that carries the run signal's reason propagates as it is, so a cancelled run writes none of these sentences and resolves its cancellation code under [Signals, cancellation, and shutdown](../core/signals.md). The runtime's own error is kept as the failure's `cause` and never printed, under [failure message voice](../core/failures.md#failure-message-voice).
- **The repository.** `<repository>` starts as `host.release.repository`. GitHub redirects a renamed or transferred repository, so the Command takes the repository from where a redirect on `https://github.com/` leads, and every later request uses it. Owners and names compare without regard to case, as GitHub's do.
- **The release channel.** The running binary's channel is `host.release.channel`. With no version, the Command resolves the newest release on the channel `--channel` names, or else on the running binary's:
  - `stable`: `https://github.com/<repository>/releases/latest`. Redirects that stay on `https://github.com/` and are not a tag page are followed, and the first that is `https://github.com/<owner>/<name>/releases/tag/v<version>` with a stable version names the release and is not requested. GitHub never resolves it to a draft or a prerelease. A redirect that leaves `https://github.com/`, a tag page whose version is not stable, or a `200` at the end of the redirects, such as `/releases` gives a repository with no release, means the channel has no release. The rows of Requests come first, so a redirect to `http:` and a 21st redirect fail as they state, and any other status fails there too.
  - Any other channel: `https://github.com/<repository>/releases.atom`, read for each `href="https://github.com/<owner>/<name>/releases/tag/v<version>"` attribute whose `<owner>/<name>` is the repository. The feed lists GitHub's newest tags, and a tag need not have a release. The candidates are the versions whose channel is that channel or `stable`, highest first by SemVer precedence, and the release is the first whose `SHA256SUMS` answers `200`; one that answers `404` is passed over, and any other failure fails the run. A tag that is not `v` and a semantic version is passed over.

  A channel with no release fails: `notes found no release on the next channel of acme/notes. Name a version to install, such as notes self-update 1.4.0.`
- **Newer only.** A resolved release whose version is the running version prints `notes 1.5.0 is the newest release on the stable channel.` and one whose version is older prints `notes 1.5.0-next.2 is newer than the newest release on the stable channel, 1.4.2. Name that version to install it: notes self-update 1.4.2.` Both exit 0 and replace nothing. A named version is the release `v<version>`, installed whether it is newer or older, and one equal to the running version prints `notes 1.5.0 is already installed.` and replaces nothing.
- **`--check`.** The Command resolves the release, fetches its `SHA256SUMS`, and checks it lists the asset under the rules of Verifying, then prints `notes can update from 1.5.0 to 1.5.1 on the stable channel.`, or for a named version `notes can install 1.4.0 in place of 1.5.0.`, or the newer-only or already-installed line, and exits 0. It downloads no binary, writes nothing, and never calls `afterReplace`.
- **Downloading.** The asset is `host.release.asset`, the running binary's own, so the platform needs no detection. The Command fetches `https://github.com/<repository>/releases/download/v<version>/SHA256SUMS`, unless resolving the channel already did, then the asset beside it.
- **Verifying.** The asset's digest comes from `SHA256SUMS` under [the release shape](../toolchain/install.md#the-release-shape). No line for the asset fails with `Release v1.5.0 of acme/notes has no notes-linux-x64 in its SHA256SUMS. Install a release that lists it, or ask its maintainers to publish one.`, and two lines for it with different digests with `Release v1.5.0 of acme/notes lists notes-linux-x64 twice in its SHA256SUMS with different digests. Run self-update again once the release is fixed.` A download whose SHA-256 digest differs fails with `notes-linux-x64 from v1.5.0 of acme/notes does not match its SHA256SUMS digest. Run self-update again later.`
- **Placing.** Before it writes, the Command removes leftover staging files of an earlier run from the recorded path's directory: each `.<name>.<random>.loom-staging`, where `<random>` is 16 lowercase hexadecimal digits, as [Installed files](../core/installation-record.md#installed-files) names them, and nothing else. The verified bytes go to a staging file it creates exclusively there under such a name; it sets the replaced file's permission bits on it explicitly, whatever the umask, flushes it to disk, and renames it over the recorded path. A failure or cancellation before the rename removes the staging file and leaves the binary as it was. A staging write or rename that fails, such as on a full disk, fails with `notes could not write the new binary to /home/me/.local/bin. Free space there or check its permissions, then run self-update again.` The running process keeps running the old binary.
- **Recording.** After the rename, the Command rewrites `install.json` in `applicationDirectory('installation', name, host)`, with the method `script`, the recorded path, and the digest of the bytes it placed, in the [installation record's](../core/installation-record.md) line format, with mode `600` as the installer script's `mktemp` leaves it, through a staging file in the same directory that it flushes to disk and renames, after removing leftover staging files of `install.json` there. From the rename to the end of the record the Command reads no signal. A record that cannot be written fails: `notes was updated to 1.5.0, but its installation record could not be written. Install it again with install.sh.`
- **`afterReplace`.** Once the record is written, the Command prints `Updated notes from 1.4.2 to 1.5.0.`, then calls `afterReplace` with the replaced and new versions, the recorded path, the graph's name, and the run's host, signal, and log, and awaits it. It is called even when the signal aborted after the rename, so the hook reads `signal.aborted`, and the run then resolves its cancellation code. It runs in the process that replaced the binary, so it runs the old version's code, and anything that needs the new version runs `path`. A hook that throws or rejects takes the ordinary failure path, as [When author code fails](#when-author-code-fails) states.
- **No copy, no lock.** The Command keeps no copy of the binary it replaced: a release that runs goes back with `self-update <version>`, and one that cannot start with `install.sh <version>`. Two runs at once each place whole, verified bytes, and the last rename wins the binary and, separately, the record; one run's removal of leftover staging files can remove the other's staging file, and that run then fails with the write sentence before its rename, leaving the binary whole. A record that then disagrees with the binary, as can also follow a process ended between the rename and the record, such as by a `SIGINT` whose [shutdown](../core/signals.md#the-shutdown) budget runs out before the record is written, refuses the next run as changed until `install.sh` installs again.
- **Output.** `Downloading notes-linux-x64 from v1.5.0 of acme/notes.` goes through `out.info`, and the update line, the `--check` line, and the newer-only and already-installed lines through `out.success`, so stdout stays empty. The examples above omit the glyph each lane view adds. Every other failure sentence above, a refusal, a failed request, a failed verification, a channel with no release, and a failed write or record, is a `FatalError` that exits 1; the `--channel` conflict is the `InputError` above.
- **Names.** `selfUpdate`, `SelfUpdateSettings`, `AfterReplaceContext`, `AttestationSetting`, and `NoticeSettings` are exported from `@loomcli/plugins/self-update`.

## Update notices

```text
$ notes add "Buy milk"
✓ Added note 12.
ℹ notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.
```

```ts
import { selfUpdate } from '@loomcli/plugins/self-update';

// The author turns notices off, or names a variable of the application's own beside NO_UPDATE_NOTIFIER
selfUpdate({ notices: false });
selfUpdate({ notices: { env: 'NOTES_NO_UPDATE_NOTICE' } });
```

Update notices tell an operator at a terminal that a newer release exists on the running application's release channel, after the action has run and no failure has reached the plugin's middleware. The run reads the answer from a cache file and never waits on the network: a detached copy of the application refreshes the cache about once a day. The notice is one `out.info` message, which the info lane wraps on a terminal whose `columns` is narrower than its line. [ADR-0080](../decisions/0080-the-self-update-plugin-tells-an-interactive-operator-about-a-newer-release-from-a-daily-cache.md) records the notice and cache. [ADR-0211](../decisions/0211-update-notices-name-the-package-managers-upgrade-command.md) extends them to Homebrew and npm installations.

- **Settings.** `notices` is `true`, `false`, or a plain object whose one key the plugin reads, `env`, is optional; an omitted `notices` reads as `true`. `selfUpdate()` throws a `DeclarationError` at the call for an `env` that does not match `[A-Za-z_][A-Za-z0-9_]*`, the name grammar of [Environment binding](../core/input-sources.md): [`@loomcli/plugins/self-update/settings`](../core/diagnostics.md#loomclipluginsself-updatesettings).
- **The middleware.** With `notices` other than `false`, the plugin declares a middleware with `'always'` activation, and with `false` it declares none. The middleware calls `next()` first and does nothing else before it settles. It then acts only when every condition holds, checked in this order, and otherwise returns having read no file and started nothing:
  1. `next()` resolved `'dispatched'`, and the run signal has not aborted. A rejection propagates unchanged. `'dispatched'` says the action ran, not that the run will exit 0, because output can still fail. A failure a later middleware caught is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md), so that run's outcome is what the middleware produced, and the notice follows it.
  2. `NO_UPDATE_NOTIFIER`, and the author's `env` when there is one, are unset or empty in `host.env`.
  3. `host.terminal.stdout.isTTY` and `host.terminal.stderr.isTTY` are both `true`, so a pipe, a command substitution such as `source <(notes completion bash)` in a startup file, a redirect, `app.invoke`, and the [MCP plugin](mcp.md) print nothing.
  4. `CI` is unset, empty, or `false` in `host.env`, as ci-info reads it.
  5. The routed Command is not the plugin's `self-update`.
  6. `host.release` holds a release group.
  7. `host.release` holds an installation.
  8. That installation gives a command under **The upgrade command**. The middleware hashes nothing.
  9. `applicationDirectory('cache', name, host)` answers a path.
- **The upgrade command.** The installation method determines the command. The notice reads the installation that the package-manager refusal of `self-update` reads: a matching script record whose realpath is in a Homebrew Cellar or npm's global root reads as that package manager's installation, so its notice names the manager's command, or shows nothing when the facts give none, and never names `self-update`, which would refuse. A script record whose path no longer resolves reads as recorded.

  | Method | Required facts | Command for the example |
  | --- | --- | --- |
  | `script` | A release `asset` and the installation's `digest` | `notes self-update` |
  | `brew` | `installation.formula` from the Cellar path | `brew upgrade notes-cli` |
  | `npm` | The full `release.npmPackage` baked by the build | `npm install -g @acme/notes@1.5.1`, naming the version the notice announces |

  A name gives a command only when it matches its grammar, so no command is ever quoted. A formula name is one or more of `a` to `z`, the digits, `+`, `-`, `.`, `@`, and `_`, starting with a letter or a digit. An npm package name is at most 214 characters: a segment, or `@`, a segment, `/`, and a segment, where a segment is one or more of `a` to `z`, the digits, `-`, `.`, and `_`, starting with a letter or a digit, and never `node_modules` or `favicon.ico`, the whole names npm reserves, the rule core exports as [`isNpmPackageName`](../core/release-facts.md#release-facts). A missing name, or one outside its grammar, gives no package-manager command. An installation without a command skips the notice and refresh. [ADR-0211](../decisions/0211-update-notices-name-the-package-managers-upgrade-command.md) records the grammars.
- **The cache.** `update.json` in that directory is one line: `{"format":1,"checked":"<time>","repository":"<repository>","channel":"<channel>","latest":<version>}` and a newline, the members in that order, where `<time>` is a UTC time in the `toISOString()` form, `<repository>` is `host.release.release.repository` as the release facts hold it, `<channel>` the channel looked on, and `<version>` the newest version found as a JSON string, or `null` when the channel had none. A reader passes over every other member, in any order. The cache is stale when it is not a regular file holding that object, when its `format` is not `1`, when its `repository` or `channel` differ from the running application's, and when its `checked` is not a time, is 24 hours or more before now, or is after now.
- **The notice.** When the cache is not stale for its repository and channel and its `latest` is a version newer than `host.release.release.version` by SemVer precedence, the middleware prints the notice for the installation's method through `out.info`:

  | Method | Notice |
  | --- | --- |
  | `script` | `notes 1.5.1 is available on the stable channel. Run notes self-update to update from 1.5.0.` |
  | `brew` | `notes 1.5.1 is available on the stable channel. Run brew upgrade notes-cli to update from 1.5.0.` |
  | `npm` | `notes 1.5.1 is available on the stable channel. Run npm install -g @acme/notes@1.5.1 to update from 1.5.0.` |
  | `npm`, on a prerelease channel | `notes 1.6.0-next.2 is available on the next channel. Run npm install -g @acme/notes@1.6.0-next.2 to update from 1.6.0-next.1.` |

  Each names the graph's name, the cached version, the channel, the upgrade command, and the running version. The message escapes its interpolated values through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). The notice is one `out.info` message. The info lane wraps it with its gutter on a terminal whose `columns` is narrower than the notice plus the gutter. A cache whose only fault is its `checked`, too old, after now, or not a time, still names its `latest` for the notice. The notice prints on every run that qualifies until the application is updated, unless the run's [verbosity](../core/verbosity.md) hides `info`, as `-q` does, and the run's own output comes first.
- **The refresh.** After the notice, when the cache is stale, the middleware writes the current time to `checked`, with the running application's repository and channel, and the cached `latest` when the cache's only fault is its `checked` or `null` otherwise, creating the directory and its missing parents, through a staging file in the directory and a rename. Then it starts `[...host.program, 'self-update', '--refresh-notice']` through [`host.spawn`](../core/host.md#child-programs) as a detached child, with `host.env` and the cache directory as its working directory, so it runs in a process group of its own with every stream ignored, and the run neither waits for it nor keeps the process alive for it. Writing `checked` first means a run that starts while the child is looking up, or after it failed, finds the cache fresh, so a slow or failing network costs one lookup a day.
- **Quiet faults.** A cache that cannot be read or does not parse is stale, and the middleware names it at `-vv`, under [At -v and in the log](#at--v-and-in-the-log). A `checked` that cannot be written starts no child. A child that cannot start, at the call or through `exited`, is passed over, so a [mock](../libs/testing.md#mockprocess) with no script for the refresh's program starts no refresh, and the run does not fail. Neither prints a line of its own: the `-v` line that a refresh started is missing. No fault is logged, and none changes the run's exit code. Writing the notice follows [Output and failures](../core/output.md), as every `out.info` does, and the middleware lets no rejection of that write escape, so core's output contract alone reports it.
- **`--refresh-notice`.** `self-update --refresh-notice` takes no version, `--channel`, or `--check`; beside any of them it is an `InputError` the action throws, `Option "--refresh-notice" cannot be given with other inputs. Leave out the other inputs.`, with exit 2. If the release group is absent, it fails with exit 1 and `notes has no release facts, so it cannot check for updates. Install a release build of notes, then try again.` It also fails with exit 1 when the cache directory does not resolve: `notes cannot find its cache directory because HOME is not an absolute path. Set HOME to an absolute path.`, naming the variable. It needs neither an asset nor an installation, and hashes nothing. It resolves the newest GitHub release on `host.release.release.channel` by the rules of [The release channel](#self-update-plugin), under its Requests, fetching only what resolving the channel needs and no asset, then writes `update.json` as above, with `checked` the time it finished, `latest` the version found, or `null` for a channel with no release, which is not a failure here. It then prints nothing and exits 0. A write that fails exits 1 with `notes could not write its update cache to /home/me/.cache/notes. Free space there or check its permissions, then run self-update --refresh-notice again.` A request that fails writes nothing and fails as Requests states, so `checked` keeps the time the run that started it wrote.
- **The release source.** The notice uses GitHub releases for every installation method. An application published only to npm with no GitHub releases has no newer release to announce. The lookup does not query the npm registry or Homebrew. A notice can therefore appear before the formula is bumped or the npm publish of that version finishes: until then `brew upgrade` reports that nothing is newer, the npm command fails for a version the registry does not hold yet, and the notice repeats on every qualifying run until the installation reaches the announced version.
- **Opting out.** `notices: false`, `NO_UPDATE_NOTIFIER`, and the author's `env` stop the middleware's notice and refresh. They do not stop `self-update --refresh-notice` typed by hand, because typing it asks for the lookup.
- **No lock.** Two runs that find the cache stale at once may each start a child, so concurrent runs can make more than one lookup in a day. Each writes a whole file through its own staging file and a rename, and the last rename wins.

## At -v and in the log

The Command's lines fall between the lines it already prints:

| Level | Line | When |
| --- | --- | --- |
| `-vv` | `Requested <url>.` | Before each request the Command sends, each redirect it follows included, under `--check` and `--refresh-notice` too. The line shows the URL's scheme, host, and path, and leaves out its userinfo, query, and fragment, which may carry a credential or a signature, as an asset store's signed redirect does. |
| `-v` | `Resolved v1.5.1 on the stable channel.` | A run without a version found the newest release on the channel it follows, and that release is newer, so the run goes on to replace. It is written once the lookup ends and before the `Downloading` line. On the stable channel the `SHA256SUMS` request follows it; on any other channel the lookup has already requested each candidate's `SHA256SUMS`, newest first, until one answered, and no request follows. A newer-only line or a `--check` line already names the release, so those runs write none, and a named version writes none. |
| `-v` | `Checked Sigstore's trust root in /home/me/.cache/notes/sigstore.` | With `attestation` set, sigstore-js brought the trust root current, before the first bundle is read, as [Attestation](#attestation) states. |
| `-v` | `Verified notes-linux-x64 against its attestation from .github/workflows/release.yml.` | With `attestation` set, an attestation passed, before the `Downloading` line. |
| `-v` | `Verified notes-linux-x64 against SHA256SUMS.` | The downloaded asset's digest matches the one `SHA256SUMS` lists. |

The update notices' middleware writes these after the action, in the order it acts: `Read` once it reads the cache, then the notice when the cache names a newer release, then `Started` once the refresh starts:

| Level | Line | When |
| --- | --- | --- |
| `-vv` | `Skipped the update check: <reason>` | The middleware does nothing, naming the first condition of **The middleware** that fails, in its order: `NO_UPDATE_NOTIFIER is set.`, `NOTES_NO_UPDATE_NOTICE is set.` for the author's `env`, `stdout is not a terminal.`, `stderr is not a terminal.`, `CI is set.`, `self-update is running.`, `notes is not a release build.`, `notes was not installed by install.sh, Homebrew, or npm.`, `notes was installed by npm, and its facts give no upgrade command.`, naming the installation's method, and `HOME is not an absolute path.`, naming the variable the cache directory's lookup answers. The first condition writes no line because the notice part speaks only after an action. A cancelled run writes nothing more. |
| `-v` | `Read the update check from /home/me/.cache/notes/update.json.` | The cache file holds an update cache this version reads, stale or not: a `format` 1 object for another repository or channel, or whose `latest` is not a version, is a stale cache, which writes this line and starts a refresh. |
| `-vv` | `Ignored /home/me/.cache/notes/update.json: it is not an update cache this version reads.` | Something is at the path that cannot be read, is not a regular file, does not hold the cache's object, or holds a `format` other than `1`. A missing cache writes nothing. |
| `-v` | `Started a refresh of the update check.` | The detached refresh child was started, once `host.spawn` returns it. |

```text
$ notes self-update -v
› Resolved v1.5.1 on the stable channel.
ℹ Downloading notes-linux-x64 from v1.5.1 of acme/notes.
› Verified notes-linux-x64 against SHA256SUMS.
› Replaced /home/me/.local/bin/notes.
✓ Updated notes from 1.5.0 to 1.5.1.
```

- **Paths.** A path or a URL is shown as the plugin's other sentences show it, escaped and kept on one line. The cache is the full path of `update.json`.
- **Log events.** Each is an `info` [change event](../core/logging.md#change-events). The Command records `File removed.` with `{ path }` for each leftover staging file it removes, `Binary replaced.` with `{ path, from, to }` after the rename, such as `{ path: '/home/me/.local/bin/notes', from: '1.5.0', to: '1.5.1' }`, and `File written.` for `install.json`. The middleware records `File written.` for `update.json` when it writes `checked`, and `self-update --refresh-notice` records it for the cache it writes. Starting the detached child records no `Program run.`, because the run never learns its code. A write or a rename that fails records nothing. The Command's events and the middleware's name `@loomcli/plugins/self-update`, and so do a refresh's events, which go through the `afterReplace` context's `log`.
- **`afterReplace`.** The context carries the graph's `name` and the action's `log`, so the refreshes of [completion](completion.md), [man pages](manpage.md), and [skills](skills.md) log their lines, and an author's hook may log its own.
- **Log lines.** Each `-v` line is one `log.debug` call and each `-vv` line one `log.trace` call, whose message is a constant [message template](../core/logging.md#message-templates) with the values the line shows in the event's fields, so the screen reads the sentence the table shows and a record keeps the template. Core shows each through its [log-line view](../core/logging.md#at--v) under the run's [verbosity](../core/verbosity.md): `-v -q` shows none, the lines go to stderr whether or not it is a terminal, an [`app.invoke`](../core/invocation.md#invocation-by-name) shows them in its `messages` when its values ask for them, and under an action's `invoke` or an [MCP](mcp.md) tool call they follow the outermost run's verbosity. Every value a line shows passes through [`escapeControlCharacters`](../core/styles.md#strings-and-composition). Each line is a log event, so an installed [logging plugin](logging.md) records it at its level, and each change event the plugin records shows at `-v` too, as every `info` event does. [ADR-0165](../decisions/0165-first-party-plugins-say-what-they-did-at-v-and-record-each-change-they-make-as-a-log-event.md) records the lines and the events, and [ADR-0174](../decisions/0174-v-shows-the-log-through-message-templates-and-out-keeps-what-the-operator-is-told.md) moves the lines onto `log`.

## When author code fails

`afterReplace` is the one author function the plugin calls. A hook that throws or rejects takes the [ordinary failure path](../core/failures.md#the-ordinary-failure-path), and an author's catch is final under [ADR-0097](../decisions/0097-one-ordinary-failure-path-where-an-authors-catch-is-final.md). The run fails after the update line, and the new binary and record stay.


## Attestation

```ts
// @loomcli/plugins/self-update/attestation
import type { AttestationSetting } from '@loomcli/plugins/self-update';

export interface AttestationSettings {
  /** The path of the workflow that runs the attestation job, in the application's repository, such as .github/workflows/release.yml. */
  readonly workflow: string;
}
export declare function attestation(settings: AttestationSettings): AttestationSetting;
```

```ts
import { Application } from '@loomcli/core';
import { selfUpdate } from '@loomcli/plugins/self-update';
import { attestation } from '@loomcli/plugins/self-update/attestation';

export const notes = new Application('notes', {
  plugins: [selfUpdate({ attestation: attestation({ workflow: '.github/workflows/release.yml' }) })],
});
```

```text
$ notes self-update -v
› Resolved v1.5.1 on the stable channel.
› Checked Sigstore's trust root in /home/me/.cache/notes/sigstore.
› Verified notes-linux-x64 against its attestation from .github/workflows/release.yml.
ℹ Downloading notes-linux-x64 from v1.5.1 of acme/notes.
› Verified notes-linux-x64 against SHA256SUMS.
› Replaced /home/me/.local/bin/notes.
✓ Updated notes from 1.5.0 to 1.5.1.
```

An [attestation](../glossary.md#releases) is a statement, signed through Sigstore, that a run of a GitHub Actions workflow built a file with a given name and SHA-256 digest. `SHA256SUMS` proves that the asset is the file the release lists. A verified attestation also shows that the pinned workflow, run on the release's own tag in the application's repository, built it, so a binary uploaded to the release by hand, or built by another workflow, on another ref, or in another repository, does not pass. It does not show who started that run: anyone who can push a `v*` tag, or dispatch the workflow on one, can have it build and attest their own commit, so the author protects those refs, as [The release workflow](#attestation) states. With `attestation` set, self-update verifies an attestation of the asset before it downloads the asset, and an update with no attestation that verifies fails. [ADR-0212](../decisions/0212-self-update-verifies-a-github-artifact-attestation-when-the-author-opts-in.md) records the decision.

- **The setting.** `attestation({ workflow })` returns the value `selfUpdate()` takes as `attestation`. `workflow` is the path, in the application's repository, of the workflow file that runs the attestation job: `.github/workflows/`, then a file name that holds no `/` and ends in `.yml` or `.yaml`, because GitHub runs workflows only from that folder. When the job runs in a reusable workflow of the same repository, the pinned path is that reusable workflow's, because the signing identity names the file that ran the job. `attestation()` throws a `DeclarationError` at the call for any other value, with the diagnostic code `@loomcli/plugins/self-update/attestation-workflow`.
- **Only `attestation()` makes it.** `AttestationSetting` carries a member keyed by an unexported unique symbol, so an object literal such as `{ workflow: '.github/workflows/release.yml' }` does not compile as one. `selfUpdate()` throws a `DeclarationError` at the call, with the diagnostic code `@loomcli/plugins/self-update/attestation-setting`, for an `attestation` that is neither `undefined` nor a value `attestation()` made, which reaches it from JavaScript or through `any`. A set attestation is never read as unset: when the Command cannot run it, the update fails. Without `attestation`, self-update makes the same requests, in the same order, with the same outcomes as the sections above state.
- **The packages.** The subpath verifies with sigstore-js: `@sigstore/verify`, `@sigstore/bundle`, and `@sigstore/tuf`, which are optional peer dependencies of `@loomcli/plugins`. An application that imports the subpath adds them to its own dependencies. Only the subpath imports them, so an application that does not import it bundles no sigstore code, and `@loomcli/plugins/self-update` alone stays as small as before. The subpath runs on Node `^22.22.2 || ^24.15.0 || >=26.0.0`, the range sigstore-js declares, narrower than the package's own; the rest of `@loomcli/plugins` keeps its range.
- **When it runs.** Once the release's `SHA256SUMS` lists the asset under [Verifying](#self-update-plugin), and before the asset is downloaded, the Command verifies an attestation for the digest `SHA256SUMS` lists. It then downloads the asset and checks it against that digest, as before, so it places nothing whose name and SHA-256 the verified attestation does not name. `--check`, the update notices, and `--refresh-notice` make no attestation request, read no trust root, and do not resolve the cache directory for it, so the refusal below never stops them.
- **Before any request.** The trust root lives in the cache directory, so the Command resolves `applicationDirectory('cache', name, host)` after the refusals above and before any request. When it answers `{ variable }`, the Command refuses with exit 1: `notes cannot find its cache directory, where it keeps Sigstore's trust root, because HOME is not an absolute path. Set HOME to an absolute path, then run self-update again.`, naming the variable the lookup answers.
- **The requests.** After `SHA256SUMS`, the Command makes these, in this order. Each request it makes itself follows the rules of [Requests](#self-update-plugin): an HTTPS start, each redirect followed by the Command itself and only to HTTPS, at most 20, no token, no time limit, and the run signal read throughout.
  1. **The list.** `https://api.github.com/repos/<owner>/<name>/attestations/sha256:<digest>?per_page=10&predicate_type=provenance`, once, for the repository the Command resolved and the digest `SHA256SUMS` lists, with `Accept: application/vnd.github+json` and `X-GitHub-Api-Version: 2026-03-10`. Its `200` body lists the attestations as `{"attestations":[…]}`. The Command reads this one page and follows no `Link` header, because each further page would spend another request of the address's hourly limit, and a release attests a digest once for each run of its workflow. The page bounds the attestations it tries at ten. An empty list fails here, before the trust root.
  2. **The trust root.** Sigstore-js brings Sigstore's trust root current from `https://tuf-repo-cdn.sigstore.dev`, once, before the first bundle, because every attestation is verified against the same trust root and a fault there is one fault of the run, not one per attestation. It starts from the root that `@sigstore/tuf` ships, every time. With a current cache, that is two small requests; each version of Sigstore's root since that one adds one, and a change on Sigstore's side adds up to three more. Each update also writes the `trusted_root.json` that `@sigstore/tuf` ships over the cached one, so once Sigstore's trust root has changed since that package version, every update downloads it again, one more request of a few kilobytes, until the application ships a newer `@sigstore/tuf`.
  3. **The bundles.** For each listed attestation, in the order GitHub lists them, the Command reads its bundle, verifies it, and stops at the first that passes. A bundle that GitHub gives inline as an object needs no request. Otherwise the Command requests the attestation's `bundle_url`, on any HTTPS host. An attestation whose `bundle` is not an object and whose `bundle_url` is missing or not an absolute HTTPS URL makes no request, and its bundle does not read. GitHub serves it from short-lived signed URLs on its blob storage. A bundle request that fails, by a status other than `200`, no response, or a redirect fault, fails the run under the rows of [Requests](#self-update-plugin), with no further attestation tried, because that storage serves every bundle of the answer; the URL is shown without its query, which carries a signature.

  The TUF requests are sigstore-js's own. Each has sigstore-js's 5-second limit and up to two retries after a network error or a `5xx`, because no abort signal reaches them. Sigstore-js follows their redirects through the platform's `fetch`, and TUF's signatures decide what the files may say. When the run signal aborts, the Command stops waiting and propagates the reason, as for every other request.
- **Reading a bundle.** The bundle URL's body is the bundle's JSON in Snappy's block format. The subpath decodes it with a small decoder of Loom's own, which reads only that format, not Snappy's framing format, and takes no dependency. The decoder reads the declared uncompressed length first and refuses a length above 1 MiB before it allocates anything, since a bundle is a few kilobytes, and it refuses an element that would write past that length or copy from before the start of what it has written. The decoded bytes, or the inline bundle, then parse as JSON and as a Sigstore bundle that `@sigstore/bundle` reads, with a DSSE envelope.
- **The verification.** An attestation passes when each step holds, in this order:
  1. **The bundle reads.** It decodes and parses as above.
  2. **Sigstore's checks.** `@sigstore/verify`'s `Verifier`, built with no options, verifies the bundle in full against the trust root. It requires all of these at once, each threshold sigstore-js's default of one: a certificate that chains to a Fulcio authority in the trust root; at least one signed certificate timestamp from a certificate-transparency log in the trust root; at least one transparency-log entry whose body matches the signature and whose inclusion verifies, by a signed entry timestamp or by an inclusion proof against a signed checkpoint; at least one verified timestamp, from a log entry with a signed entry timestamp or from a timestamp authority in the trust root; and the envelope's signature by the certificate's key. Neither the author nor the operator can lower them.
  3. **The identity.** The certificate's issuer is `https://token.actions.githubusercontent.com`. Its subject alternative name starts with `https://github.com/<owner>/<name>/<workflow>@`, where the ref after the `@` is any ref. Its Source Repository URI extension, OID `1.3.6.1.4.1.57264.1.12`, is `https://github.com/<owner>/<name>`, which refuses a run of another repository that calls the pinned workflow as a reusable workflow. In each, `<owner>/<name>` is either `host.release.repository`, the repository the release facts hold, or the repository the Command resolved through GitHub's redirect, as [The repository](#self-update-plugin) states, so an update across a rename or a transfer passes. The owner and name compare without regard to case, as GitHub's do, and every other character compares exactly. The Command compares the name itself and does not hand it to sigstore-js as a pattern, which sigstore-js would read as an unanchored regular expression.
  4. **The release.** The certificate's Source Repository Ref extension, OID `1.3.6.1.4.1.57264.1.14`, is exactly `refs/tags/v<version>` for the version being installed, such as `refs/tags/v1.5.1`. So an attestation of an older release, or of a build from a branch, does not pass for this one.
  5. **The statement.** The envelope's payload type is `application/vnd.in-toto+json`. Its statement's `_type` is `https://in-toto.io/Statement/v1` and its `predicateType` is `https://slsa.dev/provenance/v1`. One of its subjects has both a `name` equal to `host.release.asset`, such as `notes-linux-x64`, and a `sha256` digest equal to the digest `SHA256SUMS` lists, compared in lowercase.

  The Command reads both extensions from the signer `@sigstore/verify` returns and decodes each as a DER `UTF8String`. A missing extension, or one that does not decode, fails the step that reads it. The Command never falls back to the digest alone. A rate limit, a missing attestation, and a failed step each fail the update.
- **Failures.** Each of these fails the run with exit 1 before the asset is downloaded. It replaces nothing and writes no record. Each sentence lives in the plugin's messages module, escapes every value it repeats, and quotes no Node.js, engine, or library reason. When every listed attestation fails, the sentence is the fault of the attestation that got furthest through the verification's steps, and the first of those when several tie.

  | The case | The sentence and correction |
  | --- | --- |
  | The API answers `403` or `429` with `x-ratelimit-remaining: 0` or a `retry-after` header: GitHub's limit for the address. | `GitHub refused to list the attestations of notes-linux-x64 from v1.5.1 of acme/notes, because this address reached its hourly limit of requests. Run self-update again in 12 minutes.`, with the minutes rounded up from `retry-after`, or else `x-ratelimit-reset`, `1 minute` for one, and `Run self-update again later.` when neither gives a time. |
  | The API answers any other status than `200`, such as `404` for a repository the API no longer serves or `400` for an API version GitHub retired. | `GitHub could not list the attestations of notes-linux-x64 from v1.5.1 of acme/notes (404). Run self-update again later. If it fails again, install the newest release with install.sh.` No response and a redirect fault fail under the rows of [Requests](#self-update-plugin). |
  | The API's `200` body is not an object whose `attestations` is a list of objects. | `GitHub's list of the attestations of notes-linux-x64 from v1.5.1 of acme/notes is not in a form notes 1.5.0 reads. Install the newest release with install.sh.` |
  | The API lists no attestation for the digest, as for a release published before the repository attested its assets. | `Release v1.5.1 of acme/notes has no attestation for notes-linux-x64. Install a release that has one by naming its version, or ask its maintainers to attest their release assets.` |
  | Sigstore-js cannot reach `tuf-repo-cdn.sigstore.dev`: a `TUFError` whose `cause` carries a numeric `statusCode`, tuf-js's fault for a response, or is a rejection of the platform's `fetch`, a `TypeError` or a `DOMException` named `TimeoutError`. A `TypeError` cause is always this row, even when it carries a `code` and a `path`, as Bun's `fetch` rejection does for `ENOTFOUND` or `ECONNREFUSED`. | `notes could not reach tuf-repo-cdn.sigstore.dev to bring Sigstore's trust root current (503). Run self-update again later.`, with `(no response)` when none arrived. |
  | The trust root's folder cannot be created, written, or read: a system error, one that is not a `TypeError` and has a string `code` and a `path` inside the trust root's folder, that the call throws or that a `TUFError` carries as its `cause`. A file in place of the folder is one. | `notes could not use /home/me/.cache/notes/sigstore, where it keeps Sigstore's trust root. Free space there, check its permissions, or remove it, then run self-update again.` |
  | Sigstore-js cannot stage a download in the temporary folder: a system error, one that is not a `TypeError` and has a string `code` and a `path` outside the trust root's folder, that a `TUFError` carries as its `cause`. | `notes could not use the temporary folder /tmp to download Sigstore's trust root. Free space there or check its permissions, then run self-update again.` |
  | Any other fault of the trust root: metadata that does not verify or has expired, which a wrong clock also causes, a write that tuf-js reports without a path, and every fault of the snapshot or targets metadata, which tuf-js reports as a `RuntimeError` that carries only message text. | `notes could not bring Sigstore's trust root current from tuf-repo-cdn.sigstore.dev. Check that this computer's clock is right and that /home/me/.cache/notes/sigstore and the temporary folder /tmp have free space and can be written, then run self-update again later.` |
  | No bundle reads: the body does not decode, declares more than 1 MiB, or does not parse as a Sigstore bundle that this binary's `@sigstore/bundle` reads, with a DSSE envelope, or the attestation's `bundle` is not an object and its `bundle_url` is missing or not an absolute HTTPS URL. | `notes cannot read the attestation of notes-linux-x64 from v1.5.1 of acme/notes. Run self-update again later. If it fails again, install the newest release with install.sh.` |
  | The bundle fails Sigstore's checks: a tampered signature, a certificate outside the trust root, or a missing log entry, certificate timestamp, or verified timestamp. | `The attestation of notes-linux-x64 from v1.5.1 of acme/notes does not verify against Sigstore's trust root. Tell its maintainers, and name another version to install a release that verifies.` |
  | The bundle names another issuer, workflow, or repository. | `The attestation of notes-linux-x64 from v1.5.1 of acme/notes was not made by .github/workflows/release.yml in acme/notes. Tell its maintainers, and name another version to install a release that verifies.` |
  | The bundle comes from a run on another ref than `refs/tags/v1.5.1`. | `The attestation of notes-linux-x64 from v1.5.1 of acme/notes comes from a run that was not on tag v1.5.1. Tell its maintainers to attest from the tag, and name another version to install a release that verifies.` |
  | The bundle's statement has another payload, statement, or predicate type, or no subject with both the asset's name and the digest. GitHub listed it for that digest, so this is not a fault that goes away later. | `The attestation of notes-linux-x64 from v1.5.1 of acme/notes does not name notes-linux-x64 with the digest its SHA256SUMS lists. Tell its maintainers, and name another version to install a release that verifies.` |

  The trust-root rows are told apart by facts alone: the `TUFError` class and `code` that `@sigstore/tuf` exports, the `statusCode` and class of its `cause`, and a system error's `code` and `path`, never the text of a message. The rows are read in order: a `TypeError` cause is the unreachable row before any folder row reads its `code` or `path`, and a system error is one that is not a `TypeError`. A system error's path counts as inside the trust root's folder when it is that folder or below it. The temporary folder the sentences name is `host.tmpdir`, the folder sigstore-js's `os.tmpdir()` gives too unless `TMPDIR` is unset or relative and `TMP` or `TEMP` is set. A rejection that carries the run signal's reason propagates as it is.
- **The trust root's folder.** Sigstore-js keeps the trust root in `sigstore` in the cache directory, `applicationDirectory('cache', name, host)`, such as `/home/me/.cache/notes/sigstore` on Linux and `/Users/me/Library/Caches/notes/sigstore` on macOS, beside the update notices' `update.json`. It creates the folders it needs, and under `sigstore/tuf-repo-cdn.sigstore.dev/` it writes `root.json`, `timestamp.json`, `snapshot.json`, `targets.json`, and in `targets/` the `trusted_root.json` that verification reads, with a seeded npm key file that self-update does not read. It writes each file in place, and stages each download in a folder under the temporary folder that it removes afterwards.
- **The folder is security state.** The trust root decides which signatures verify, so what is in this folder matters, not only whether it is there. The Command calls sigstore-js so that every update writes the root `@sigstore/tuf` ships over the cached one and walks forward from it over TUF. A planted or damaged file in the folder is then replaced, discarded because the shipped root's chain does not sign it, or downloaded again. The most it can do is stop updates, with one of the sentences above, and removing the folder always recovers: the next update seeds it again. Every update checks for a new trust root. The cache saves the download of metadata that has not changed, not the check, and it does not save the download of the trust root itself once Sigstore's differs from the one `@sigstore/tuf` ships.
- **Bundle size.** Sigstore's code is present only when the application imports `@loomcli/plugins/self-update/attestation`. The settings type names `AttestationSetting` from `@loomcli/plugins/self-update`, which imports no sigstore package, so an application that leaves `attestation` unset bundles none of it.
- **At -v and in the log.** `-vv` writes `Requested <url>.` before the API request and each bundle request, under [At -v and in the log](#at--v-and-in-the-log). `-v` writes `Checked Sigstore's trust root in /home/me/.cache/notes/sigstore.` once the trust root is current, and `Verified notes-linux-x64 against its attestation from .github/workflows/release.yml.` once an attestation passes, both before the `Downloading` line. Sigstore-js makes the TUF requests and writes the cache files itself, and reports neither, so no `Requested` line names a TUF request and no `File written.` event records a cache file. Its `debug` package writes its own lines to the process's stderr when the operator sets `DEBUG`, such as `DEBUG=tuf:*`, outside the run's verbosity.
- **The release workflow.** The author's release workflow attests each binary asset with `actions/attest-build-provenance`, which needs the `id-token: write` and `attestations: write` permissions, in a job of the pinned workflow that runs on the release's tag: on a push of a `v*` tag, as below, on a `release` event, or on a dispatch whose ref is the tag. A workflow that attests from a branch and tags afterwards makes attestations whose ref is the branch, and they do not verify. Every release published after the setting ships needs an attestation, so an operator on that binary cannot self-update to a release without one.

  ```yaml
  # .github/workflows/release.yml
  on:
    push:
      tags: ['v*']
  permissions:
    contents: write
    id-token: write
    attestations: write
  jobs:
    release:
      runs-on: ubuntu-latest
      environment: release
      steps:
        - uses: actions/checkout@v5
        - uses: oven-sh/setup-bun@v2
        - run: bun install --frozen-lockfile
        - run: |
            for target in darwin-arm64 linux-x64 linux-arm64; do
              bunx loom build --release --target "bun-$target" --out "dist/notes-$target"
            done
            (cd dist && sha256sum notes-* > SHA256SUMS)
        - uses: actions/attest-build-provenance@v3
          with:
            subject-path: 'dist/notes-*'
        - run: gh release create "$GITHUB_REF_NAME" dist/notes-* dist/SHA256SUMS
          env:
            GH_TOKEN: ${{ github.token }}
  ```

  The build and publish steps follow [the release shape](../toolchain/install.md#the-release-shape). The attestation step comes after the assets are built and before they are published, and `subject-path` matches every binary asset and not `SHA256SUMS`. Each subject's name is its file's base name, so each file is built under its asset's name, as `dist/notes-linux-x64` is here, and is not renamed on upload.

  An attestation names the tag by name, not by commit, so an attestation from a deleted tag's run still verifies for a tag made again with that name. Publish a new version rather than re-tag one. An attestation shows which workflow ran on which tag, not who pushed the tag. The author protects that with a tag ruleset on `v*` that limits who can create, update, or delete those tags, and with an environment, `release` above, whose required reviewers approve each run before the job gets its signing identity.

  The repository must be public, because self-update reads the attestations, like the release itself, without a token. The pinned workflow is the one that runs the attestation job, and it must be in the application's own repository: a reusable workflow from another repository signs with that repository's path, and a run of another repository that calls this one signs with the caller's repository, so neither passes.
