---
description: The release facts core delivers to an application, and development builds.
---

# Release facts

This page states the release facts core delivers to an application through `host.release`, and how a development build reports them. An author reads it to learn how the running application was built, released, and installed.

```ts
interface ReleaseFacts {
  readonly build: 'source' | 'development' | 'distributed';
  readonly release?: {
    readonly version: string;
    readonly channel: string; // derived by core from version
    readonly repository: string; // owner/name
    readonly asset?: string; // a compiled binary's release asset name
  };
  readonly installation?: {
    readonly method: string;
    readonly path: string;
    readonly digest: string;
  }; // read from the installation record, for a compiled binary built with --release
}
interface Host {
  readonly release: ReleaseFacts;
  readonly program: readonly string[]; // the runtime and script prefix argv omits
  // ...the fields under Host...
}
```

```ts
// src/commands/about.ts
import { Command } from '@loomcli/core';

export const about = new Command('about', { description: 'Print how this copy was built.' }).action(({ host, out }) => {
  const { build, release } = host.release;
  return out.print(release === undefined ? `${build} build` : `${release.version} (${release.channel}) from ${release.repository}`);
});
```

```sh
loom build --target node                  # the bundle reads { build: 'distributed' }
bun src/main.ts about                     # the source run reads { build: 'source' }
loom build --target bun-linux-x64 --release
# the binary reads { build: 'distributed', release: { version: '1.1.0-next.3', channel: 'next',
#   repository: 'acme/notes', asset: 'notes-linux-x64' } }
```

Release facts say how the running application was built, released, and installed. The build bakes the build and release group into the artifact, core reads the installation from the [installation record](installation-record.md), and core fills `host.release` from them for every run, so an action reads them from its host. An author imports no file and passes nothing. [ADR-0065](../decisions/0065-release-facts-on-the-host-say-how-the-running-application-was-built.md) records the decision, which supersedes [ADR-0050](../decisions/0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md).

- **`build`.** `source` when the source runs directly with nothing baked in, such as `bun src/main.ts`. `development` for a development artifact, such as one `loom build --watch` or `loom build --build development` writes. `distributed` for a distributed artifact, which `loom build` writes by default. The build decides how core reports what only the author can fix, under [Development builds](#development-builds).
- **`release`.** Present only when the artifact was built with `loom build --release`. `version` is the package's version, and `repository` is the repository the release belongs to, as `owner/name`. `asset` is the release asset's name, present for a compiled binary alone.
- **The release channel.** Core derives `channel` from `version`: the first prerelease identifier, so `1.1.0-next.3` reads `next` and `1.0.0-beta.1` reads `beta`, and `stable` when the version has none. It is a string, not a closed set, and the build never bakes it.
- **`installation`.** How the application was installed, where it was installed, and the digest of what was installed. The build never bakes it. Core reads it from the [installation record](installation-record.md) for a compiled binary built with `--release`, and only when the recorded path is the running executable.
- **The define.** The build bakes one identifier, `__LOOM_RELEASE__`, through a bundler `define`. Its value is JSON, `{ "build": ..., "compiled"?: true, "release"?: { "version", "repository", "asset"? } }`, where `compiled` marks a compiled binary for [`host.program`](host.md) and a `compiled` other than `true` is malformed, naming the member, which the bundler substitutes as an object literal. Core reads the identifier behind a `typeof` guard, so a source run, where nothing replaced it, reads it as absent. A define reaches code inside `node_modules`. The define reaches core only when the bundle includes `@loomcli/core`; a build that leaves core external reads `source`. `Bun.build({ define })` and the `bun build` command line's `--define`, `--watch` included, both take one, and so does every common bundler, such as esbuild, Rollup, and Vite. [`loom build`](../toolchain/build.md#loom-build) bakes it, and its `--facts` and `--define` options print the value, so an author composes a custom build from the same facts.
- **No baked facts is source.** An artifact built without the define reads `{ build: 'source' }`, as the source run does, and shows the author's detail. An application ships through `loom build`, and anything else counts as unbuilt.
- **Captured with the host.** `run()` and `app.invoke` read the release facts from the run's [process handle](host.md#the-process-handle) during host capture, once per run, and freeze them, and the real process's handle reads the baked facts. An action's `invoke` reads its run's facts. A supplied `release`, `processHandle({ release })` or `mockProcess({ release })`, replaces the whole field as any supplied field does, which is how a test supplies facts. Core takes it as given and reads no baked value and no installation record.
- **Without a host.** `inspect()` takes no host, so it reads the baked facts to learn its build. [`check()`](graph-inspection.md#checking-the-declarations) reads none, because it runs the development checks whatever the build.
- **A malformed value.** A baked value that is not a plain object, whose `build` is not one of the three values, or whose `release`, when present, is not a plain object with a `version` that is a semantic version and a `repository` of the form `owner/name`, or holds an `asset` that is not a nonempty string, is a defect under `@loomcli/core/invalid-release-facts`. Core ignores every other member, so a later toolchain can bake more facts under this core. Core reports the defect before the graph builds. The build step that baked the value is the author's, so core always reports it as its Developer Diagnostic, whose sentence names the member at fault, such as `The release facts baked into __LOOM_RELEASE__ hold build "staging".`, and whose correction is `Rebuild with loom build, or compose the define from loom build --define.` `run()` exits 1, `app.invoke` resolves `failed` with exit 1, and `inspect()` throws the `InternalError`. Its failure form's `message` is the fault's sentence in every build.
- **Names.** `ReleaseFacts` is exported from `@loomcli/core`, and `Host` carries `release`.

## Development builds

A development build is a run whose release facts read `source` or `development`. A distributed build is a run whose release facts read `distributed`. The build decides how core renders what only the author can fix. Everything else prints the same bytes in both builds.

| What `run()` reports                                                                 | Development build | Distributed build |
| ------------------------------------------------------------------------------------ | ----------------- | ----------------- |
| A usage error, a `FatalError`, or an author's own class, a [translated](failures.md#translators) one included | Its view, unchanged | Its view, unchanged |
| A defect: an `InternalError` or `ResultError`                                          | Its Developer Diagnostic, ahead of every override | `jsonkit: Something went wrong.` through its view, at most once per run |
| A `DeclarationError` from build or from a run: a hook fault, a declared default or implied value its validator rejects, a validator that throws or returns a malformed result | Its Developer Diagnostic, ahead of every override | `jsonkit: Something went wrong.` through its view, at most once per run |
| A broken failure view or [failure encoder](failure-views.md#failure-encoders), after the failure's own text | One Developer Diagnostic per broken contract, in the order [ordinary failure path](failures.md#the-ordinary-failure-path) gives | `jsonkit: Something went wrong.`, at most once per run |

A `DeclarationError` thrown at a call or an attach never reaches `run()`, and its message carries its diagnostic in both builds, under [Declaration faults](declaration-faults.md). Malformed baked facts leave the build unknown, so their defect renders its Developer Diagnostic in both, under [Release facts](#release-facts).

- **The generic message.** It is the application name, a colon, and `Something went wrong.`, with no reason, class name, code, or path. A run writes it at most once, whichever faults it reports, so a second defect that core's own view renders writes nothing. It is the default text of `InternalError` and `DeclarationError` in a distributed build, so `override(InternalError, view)` replaces it for defects and `override(DeclarationError, view)` for declaration faults, and an `onFailure` hint, such as where to report the defect, prints under it. It is the one operator message with no next step, because a defect has none Loom can name, as rule 7 of [failure message voice](failures.md#failure-message-voice) states.
- **Exit codes.** A defect and a declaration fault exit 1 in both builds, and a cancelled run keeps its signal's code under [Signals, cancellation, and shutdown](signals.md).
- **Checks only development runs.** A development build reports author mistakes a distributed build tolerates. A validated input's converter that throws or returns anything other than a plain object is a `DeclarationError` at build under the rule `@loomcli/core/schema-converter-failed`, naming the input, the target, and the converter's message, from `run()` and from `inspect()`; a distributed build reads its [input schema](validation.md#input-schema) as `null`. The configuration source's schema converter is checked the same way, naming the plugin, and a distributed build reads the graph's `configuration.schema` as `null`. The check runs for `source` and for `development`, and [`check()`](graph-inspection.md#checking-the-declarations) runs it in every build. The routing check of a [post-install command](application.md#the-post-install-declaration), `@loomcli/core/post-install-unrouted`, runs in the same builds. A missing description is a lint rule rather than a check a run makes, under [ADR-0098](../decisions/0098-lint-is-the-author-guidance-lane.md).
- **The failure form.** A defect's or a declaration fault's [failure form](failures.md#the-failure-form) follows the build too: its `message` reads `Something went wrong.` in a distributed build and the fault's sentence in a development one, and its `code` reads `internal` in both.
