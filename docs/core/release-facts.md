---
description: The release facts core delivers to an application, and development builds.
---

# Release facts

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
  readonly release: ReleaseFacts; // new
  readonly program: readonly string[]; // new: the runtime and script prefix argv omits
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

Release facts say how the running application was built, released, and installed. The build bakes the build and release group into the artifact, core reads the installation from the [installation record](installation-record.md), and core fills `host.release` from them for every run, so an action reads them from its host. An author imports no file and passes nothing. [ADR-0065](../decisions/0065-release-facts-on-the-host-say-how-the-running-application-was-built.md) records the decision, which replaces the packet of [ADR-0050](../decisions/0050-a-packet-built-into-the-application-says-whether-it-is-in-development.md).

- **`build`.** `source` when the source runs directly with nothing baked in, such as `bun src/main.ts`. `development` for a development artifact, such as one `loom build --watch` or `loom build --build development` writes. `distributed` for a distributed artifact, which `loom build` writes by default. The build decides how core reports what only the author can fix, under [Development builds](#development-builds).
- **`release`.** Present only when the artifact was built with `loom build --release`. `version` is the package's version, and `repository` is the repository the release belongs to, as `owner/name`. `asset` is the release asset's name, present for a compiled binary alone.
- **The release channel.** Core derives `channel` from `version`: the first prerelease identifier, so `1.1.0-next.3` reads `next` and `1.0.0-beta.1` reads `beta`, and `stable` when the version has none. It is a string, not a closed set, and the build never bakes it.
- **`installation`.** How the application was installed, where it was installed, and the digest of what was installed. The build never bakes it. Core reads it from the [installation record](installation-record.md) for a compiled binary built with `--release`, and only when the recorded path is the running executable.
- **The define.** The build bakes one identifier, `__LOOM_RELEASE__`, through a bundler `define`. Its value is JSON, `{ "build": ..., "compiled"?: true, "release"?: { "version", "repository", "asset"? } }`, where `compiled` marks a compiled binary for [`host.program`](host.md) and a `compiled` other than `true` is malformed, naming the member, which the bundler substitutes as an object literal. Core reads the identifier behind a `typeof` guard, so a source run, where nothing replaced it, reads it as absent. A define reaches code inside `node_modules`. The define reaches core only when the bundle includes `@loomcli/core`; a build that leaves core external reads `source`. `Bun.build({ define })` and the `bun build` command line's `--define`, `--watch` included, both take one, and so does every common bundler, such as esbuild, Rollup, and Vite. [`loom build`](../toolchain/build.md#loom-build-1) bakes it, and its `--facts` and `--define` options print the value, so an author composes a custom build from the same facts.
- **No baked facts is source.** An artifact built without the define reads `{ build: 'source' }`, as the source run does, and shows the author's detail. An application ships through `loom build`, and anything else counts as unbuilt.
- **Captured with the host.** `run()` and `app.invoke` read the baked facts during host capture, once per run, and freeze them. An action's `invoke` reads its run's facts. A `release` override, `run({ host: { release } })` or `app.invoke`'s `host: { release }`, replaces the whole field as any host override does, which is how a test supplies facts. Core takes the override as given and reads no baked value and no installation record.
- **Without a host.** `inspect()` takes no host, so it reads the baked facts to learn its build. [`check()`](graph-inspection.md#checking-the-declarations) reads none, because it runs the development checks whatever the build.
- **A malformed value.** A baked value that is not a plain object, whose `build` is not one of the three values, or whose `release`, when present, is not a plain object with a `version` that is a semantic version and a `repository` of the form `owner/name`, or holds an `asset` that is not a nonempty string, is a defect under `@loomcli/core/invalid-release-facts`. Core ignores every other member, so a later toolchain can bake more facts under this core. Core reports the defect before the graph builds. The build step that baked the value is the author's, so core always reports it as its Developer Diagnostic, whose sentence names the member at fault, such as `The release facts baked into __LOOM_RELEASE__ hold build "staging".`, and whose correction is `Rebuild with loom build, or compose the define from loom build --define.` `run()` exits 1, `app.invoke` resolves `failed` with exit 1, and `inspect()` throws the `InternalError`. Its failure form's `message` is the fault's sentence in every build.
- **The packet is removed.** The Application's `packet` option, the `Packet` type, `loom.packet.json`, and `packet()` from `@loomcli/loom/build` are gone, and the word leaves the public vocabulary. The types reject a `packet` option, and core adds no rule for one.
- **Names.** `ReleaseFacts` is exported from `@loomcli/core`, and `Host` gains `release`.

## Development builds

A development build is a run whose release facts read `source` or `development`. A distributed build is a run whose release facts read `distributed`. The build decides how core renders what only the author can fix. Everything else prints the same bytes in both builds.

| What `run()` reports                                                                 | Development build | Distributed build |
| ------------------------------------------------------------------------------------ | ----------------- | ----------------- |
| A usage error, a `FatalError`, or an author's own class, a [translated](failures.md#translators) one included | Its view, unchanged | Its view, unchanged |
| A defect: an `InternalError` or `ResultError`                                          | Its Developer Diagnostic, ahead of every override | `jsonkit: Something went wrong.` through its view, at most once per run |
| A `DeclarationError` from build or from a run: a hook fault, a declared default or implied value its validator rejects, a validator that throws or returns a malformed result | Its Developer Diagnostic, ahead of every override | `jsonkit: Something went wrong.` through its view, at most once per run |
| A broken failure view or [failure encoder](failure-views.md#failure-encoders), after the failure's own text | One Developer Diagnostic per broken contract, in the order [Failure contract](failures.md#failure-contract) gives | `jsonkit: Something went wrong.`, at most once per run |

A `DeclarationError` thrown at a call or an attach never reaches `run()`, and its message carries its diagnostic in both builds, under [Declaration faults](declaration-faults.md). Malformed baked facts leave the build unknown, so their defect renders its Developer Diagnostic in both, under [Release facts](#release-facts).

- **The generic message.** It is the application name, a colon, and `Something went wrong.`, with no reason, class name, code, or path. A run writes it at most once, whichever faults it reports, so a second defect that core's own view renders writes nothing. It is the default text of `InternalError` and `DeclarationError` in a distributed build, so `override(InternalError, view)` replaces it for defects and `override(DeclarationError, view)` for declaration faults, and an `onFailure` hint, such as where to report the defect, prints under it. It is the one operator message with no next step, because a defect has none Loom can name, as rule 7 of [Failure messages](failures.md#7-a-defect-shows-one-generic-message) states.
- **Exit codes.** A defect and a declaration fault exit 1 in both builds, and a cancelled run keeps its signal's code under [Signals and cancellation](signals.md).
- **Checks only development runs.** A development build reports author mistakes a distributed build tolerates. A validated input's converter that throws or returns anything other than a plain object is a `DeclarationError` at build under the rule `@loomcli/core/schema-converter-failed`, naming the input, the target, and the converter's message, from `run()` and from `inspect()`; a distributed build reads its [input schema](validation.md#input-schema) as `null`, as it does today. The check runs for `source` and for `development`, and [`check()`](graph-inspection.md#checking-the-declarations) runs it in every build. A missing description is a lint rule rather than a check a run makes, under [ADR-0098](../decisions/0098-lint-is-the-author-guidance-lane.md).
- **The failure form.** A defect's or a declaration fault's [failure form](failures.md#the-failure-form) follows the build too: its `message` reads `Something went wrong.` in a distributed build and the fault's sentence in a development one, and its `code` reads `internal` in both.

## Release facts acceptance

Release facts are proven when public APIs and process runs alone produce these results:

- **The examples.** jsonkit and textstat carry no packet and build with `loom build --target node`. The process tests run each bundle under Node and Bun, and every golden they pin is unchanged, because operator failures print the same bytes in both builds. A process test runs `bun src/main.ts` for each example and pins the same bytes for its usage errors.
- **A source run.** A fixture action that prints `host.release` prints `{ build: 'source' }` from source. When the action throws a `TypeError` instead, the run writes the Developer Diagnostic of `@loomcli/core/foreign-throw` and exits 1.
- **A bundle with facts.** The fixture bundled by `loom build --target node` prints `{ build: 'distributed' }` with no release group, and its throwing action writes exactly `probe: Something went wrong.` and exits 1, with no reason, class name, or path on stderr. Built with `--build development`, it prints `development` and writes the Developer Diagnostic. Built with `--release` from a package at `1.1.0-next.3` whose `repository` reads `git+https://github.com/acme/probe.git`, it prints version `1.1.0-next.3`, channel `next`, and repository `acme/probe`, with no asset, and a package at `2.0.0` reads channel `stable`. A compiled binary built with `loom build --release` for the host target reads its asset name and writes the generic message.
- **A bundle without facts.** A packed consumer bundles a fixture application with `Bun.build` and with Rolldown, each with no define. Each bundle reads `{ build: 'source' }` and writes the Developer Diagnostic for a defect under Node and Bun. Each pads wide, combining, emoji, and flag text to its display width and keeps the license notices of core's derived modules.
- **A malformed define.** A fixture bundled with `--define` values that bake `{"build":"staging"}`, `[]`, a release group whose version is `one`, and `"compiled":1` each exits 1 with the Developer Diagnostic of `@loomcli/core/invalid-release-facts` and runs no action. `app.invoke` from the same bundle resolves `failed` with exit 1, `inspect()` throws the `InternalError`, and `run({ host: { release: { build: 'distributed' } } })` runs, because the override replaces the baked value. A baked member core does not know reads as the known members alone.
- **Overrides by build.** From source, `run({ host: { release: { build: 'distributed' } } })` writes the generic message for a defect and `{ build: 'development' }` writes the Developer Diagnostic. An application override of `InternalError` renders a defect in a distributed build and is not consulted in a development build; a plugin override of `InternalError` is likewise not consulted in development. An `onFailure` hint prints under the generic message and under the Developer Diagnostic. An action's `invoke` reads its run's facts, and `app.invoke` with `host: { release }` reads the override.
- **Build faults.** A root with neither children nor an action writes the generic message from a distributed bundle and its Developer Diagnostic from source, both with exit 1, and `inspect()` throws the `DeclarationError` in both.
- **Broken contracts.** A broken failure view and a throwing `onFailure` hook each write the failure's own text and then one generic line in a distributed build, and the broken contract's Developer Diagnostic in a development build, with exit 1, or 130 in a run a caller cancelled.
- **The converter.** A validated input whose converter throws is a `DeclarationError` from `run()` and `inspect()` from source and from a `--build development` bundle, and reads `null` in a distributed bundle.
- **The packed consumer.** A packed consumer installs `@loomcli/core` and `@loomcli/loom`, compiles an action that reads `host.release` against core's emitted declarations with `skipLibCheck` off, runs `loom build --target node` in its fixture package, and the bundle reads `distributed` under Node and Bun while the source reads `source`. `@loomcli/loom` exports no `./build` subpath.

Each case runs under Node and Bun, except the source runs, which run under Bun.
